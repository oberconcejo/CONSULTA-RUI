#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
DNP Ventanilla Social / RUI Scraper & API Client
Author: Senior Python Developer & Web API Specialist
Description: Script to query the DNP (Departamento Nacional de Planeación) Ventanilla Social
             to obtain RUI data and family member information.
"""

import sys
import re
import json
import logging
import urllib3
import requests
from bs4 import BeautifulSoup

# Disable insecure request warnings (necessary since DNP SSL certificates might trigger alerts)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Document Types Mapping (Official DNP)
DOCUMENT_TYPES = {
    "1": "Registro Civil",
    "2": "Tarjeta de Identidad",
    "3": "Cédula de Ciudadanía",
    "4": "Cédula de Extranjería",
    "5": "Pasaporte",
    "9": "Permiso por Protección Temporal (PPT)"
}

class DNPApiClient:
    """Client to query the DNP Ventanilla Social and extract RUI / Hogar data."""

    BASE_URL = "https://ventanillasocial.dnp.gov.co"
    QUERY_URL = f"{BASE_URL}/Home/ObtenerDatosRUI"
    
    def __init__(self, verify_ssl=False):
        self.verify_ssl = verify_ssl
        self.session = requests.Session()
        self.headers = {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'es-CO,es-ES;q=0.9,es;q=0.8,en;q=0.7',
            'connection': 'keep-alive',
            'origin': self.BASE_URL,
            'referer': f'{self.BASE_URL}/',
            'sec-ch-ua': '"Not_A Brand";v="99", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-requested-with': 'XMLHttpRequest',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        self.session.headers.update(self.headers)
        self.csrf_token = None

    def initialize_session(self):
        """Performs initial GET request to fetch cookies and anti-forgery tokens."""
        logger.info("Inicializando sesión y cookies desde la página base...")
        try:
            # Enforce TLS settings or bypass check
            response = self.session.get(self.BASE_URL, verify=self.verify_ssl, timeout=10)
            response.raise_for_status()
            
            # Extract ASP.NET Anti-Forgery Token (__RequestVerificationToken)
            html_content = response.text
            soup = BeautifulSoup(html_content, 'html.parser')
            
            token_input = soup.find('input', {'name': '__RequestVerificationToken'})
            if token_input:
                self.csrf_token = token_input.get('value')
                logger.info("Token Anti-Forgery __RequestVerificationToken encontrado en HTML.")
            else:
                # Fallback to regex
                match = re.search(r'name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"', html_content)
                if match:
                    self.csrf_token = match.group(1)
                    logger.info("Token Anti-Forgery encontrado vía regex.")
                else:
                    logger.warning("No se encontró token anti-forgery (__RequestVerificationToken) en la página base.")

            logger.info("Cookies en la sesión: %s", self.session.cookies.get_dict())
            return True
        except Exception as e:
            logger.error("Error al inicializar sesión: %s", str(e))
            return False

    def query_rui(self, doc_number, doc_type="3"):
        """
        Queries RUI endpoint for a given document type and number.
        
        Args:
            doc_number (str): The identification document number.
            doc_type (str): The document type code (e.g. '3' for Cédula).
            
        Returns:
            dict: The parsed structured result containing household and members info.
        """
        if not self.csrf_token:
            self.initialize_session()
            
        logger.info("Realizando consulta RUI para Documento: %s (Tipo: %s)...", doc_number, DOCUMENT_TYPES.get(doc_type, doc_type))
        
        # Prepare POST data in application/x-www-form-urlencoded
        data = {
            'pNumDoc': str(doc_number),
            'pTipDoc': str(doc_type)
        }
        
        # If anti-forgery token is found, add to request body (MVC pattern)
        if self.csrf_token:
            data['__RequestVerificationToken'] = self.csrf_token
            
        try:
            response = self.session.post(
                self.QUERY_URL,
                data=data,
                verify=self.verify_ssl,
                timeout=12
            )
            
            if response.status_code != 200:
                logger.error("Error HTTP del servidor DNP: %s", response.status_code)
                return {"ok": False, "error": f"Servidor respondió con código {response.status_code}"}
            
            # Check content type to see if it is JSON or HTML PartialView
            content_type = response.headers.get('Content-Type', '')
            
            if 'application/json' in content_type:
                return self._parse_json_response(response.json())
            else:
                # If it's HTML, check if we can parse it as JSON or if it contains PartialView HTML
                text_response = response.text.strip()
                if text_response.startswith('{') or text_response.startswith('['):
                    try:
                        return self._parse_json_response(json.loads(text_response))
                    except json.JSONDecodeError:
                        pass
                
                return self._parse_html_response(text_response)
                
        except requests.exceptions.Timeout:
            logger.error("Timeout al consultar el servidor DNP.")
            return {"ok": False, "error": "Tiempo de espera agotado al conectar con el servidor DNP."}
        except Exception as e:
            logger.error("Excepción durante la consulta RUI: %s", str(e))
            return {"ok": False, "error": str(e)}

    def _parse_json_response(self, data):
        """Parses JSON response and extracts metadata + family members."""
        logger.info("Parseando respuesta JSON del servidor...")
        
        # General response checks
        if not data:
            return {"ok": False, "error": "Respuesta vacía del servidor."}
            
        # Clean/Normalize JSON structure
        result = {
            "ok": True,
            "metadatos_hogar": {
                "nombre_titular": data.get("nombre") or data.get("nombreCompleto") or "No especificado",
                "edad_titular": data.get("edad") or "No especificada",
                "sexo_titular": data.get("sexo") or "No especificado",
                "municipio": data.get("municipio") or "No especificado",
                "departamento": data.get("departamento") or "No especificado",
                "grupo_sisben": data.get("grupRui") or data.get("nivelRui") or "Sin Registro",
                "grupo_ingresos": data.get("grupoIngresos") or "Sin Ingresos"
            },
            "integrantes": []
        }
        
        # Try to locate family members inside lists
        members_keys = ["integrantes", "personas", "personasHogar", "composicionFamiliar", "miembros", "nucleo"]
        members_list = None
        for key in members_keys:
            if key in data and isinstance(data[key], list):
                members_list = data[key]
                break
                
        if members_list:
            for member in members_list:
                result["integrantes"].append({
                    "nombre": member.get("nombre") or member.get("nombreCompleto") or "No especificado",
                    "tipo_documento": member.get("tipoDocumento") or member.get("tipDoc") or "Cédula de ciudadanía",
                    "numero_documento": member.get("numeroDocumento") or member.get("numDoc") or "No especificado",
                    "parentesco": member.get("parentesco") or member.get("rol") or "No especificado",
                    "sisben": member.get("grupRui") or member.get("nivelRui") or result["metadatos_hogar"]["grupo_sisben"]
                })
        else:
            # If there's no list but only the main person, add them as the sole member
            result["integrantes"].append({
                "nombre": result["metadatos_hogar"]["nombre_titular"],
                "tipo_documento": "No especificado",
                "numero_documento": "Consultado",
                "parentesco": "Titular del Hogar",
                "sisben": result["metadatos_hogar"]["grupo_sisben"]
            })
            
        return result

    def _parse_html_response(self, html_text):
        """Parses HTML PartialView and extracts family members from tables."""
        logger.info("Respuesta HTML detectada. Parseando con BeautifulSoup...")
        soup = BeautifulSoup(html_text, 'html.parser')
        
        result = {
            "ok": True,
            "metadatos_hogar": {
                "nombre_titular": "No especificado",
                "municipio": "No especificado",
                "departamento": "No especificado",
                "grupo_sisben": "Sin Registro",
                "grupo_ingresos": "Sin Ingresos"
            },
            "integrantes": []
        }
        
        # Parse main citizen name if present in cards
        name_elem = soup.find(class_=re.compile("citizen-name|nombre|titular", re.I))
        if name_elem:
            result["metadatos_hogar"]["nombre_titular"] = name_elem.text.strip()
            
        # Try to locate classification score
        class_elem = soup.find(class_=re.compile("class-badge|grupo|nivel|sisben", re.I))
        if class_elem:
            result["metadatos_hogar"]["grupo_sisben"] = class_elem.text.strip()

        # Find tables representing family members
        tables = soup.find_all('table')
        if not tables:
            # If no tables found, let's look for lists or divs with table-like structure
            rows = soup.find_all(class_=re.compile("row-integrante|row-persona|item-familiar", re.I))
            for row in rows:
                # Custom parse logic based on common classes
                cells = [c.text.strip() for c in row.find_all(['div', 'span'])]
                if len(cells) >= 3:
                    result["integrantes"].append({
                        "nombre": cells[0],
                        "tipo_documento": "Cédula",
                        "numero_documento": cells[1],
                        "parentesco": cells[2] if len(cells) > 2 else "Miembro",
                        "sisben": result["metadatos_hogar"]["grupo_sisben"]
                    })
        else:
            # Parse table rows
            for table in tables:
                rows = table.find_all('tr')
                # Skip header row if present
                for row in rows:
                    headers_in_row = row.find_all('th')
                    if headers_in_row:
                        continue
                    cells = [c.text.strip() for c in row.find_all('td')]
                    if len(cells) >= 3:
                        # Extract data based on columns layout
                        result["integrantes"].append({
                            "nombre": cells[0],
                            "tipo_documento": cells[1] if len(cells) > 3 else "No especificado",
                            "numero_documento": cells[2] if len(cells) > 3 else cells[1],
                            "parentesco": cells[3] if len(cells) > 3 else (cells[2] if len(cells) > 2 else "Miembro"),
                            "sisben": result["metadatos_hogar"]["grupo_sisben"]
                        })
                        
        # If no members were found but we have a main name, add the main name
        if not result["integrantes"] and result["metadatos_hogar"]["nombre_titular"] != "No especificado":
            result["integrantes"].append({
                "nombre": result["metadatos_hogar"]["nombre_titular"],
                "tipo_documento": "No especificado",
                "numero_documento": "Consultado",
                "parentesco": "Titular del Hogar",
                "sisben": result["metadatos_hogar"]["grupo_sisben"]
            })
            
        return result

def print_result_table(result):
    """Prints a beautiful table with the query results to the console."""
    if not result.get("ok"):
        print(f"\n[-] ERROR: {result.get('error')}\n")
        return
        
    meta = result["metadatos_hogar"]
    members = result["integrantes"]
    
    print("\n" + "="*86)
    print("                 DETALLES DEL HOGAR (REGISTRO SOCIAL DNP)           ")
    print("="*86)
    print(f" Titular del Hogar:  {meta['nombre_titular']}")
    print(f" Ubicación:          {meta['municipio']} — {meta['departamento']}")
    print(f" Clasificación RUI:  {meta['grupo_sisben']}  |  Ingresos: {meta['grupo_ingresos']}")
    print("="*86)
    print("                         INTEGRANTES DEL NÚCLEO FAMILIAR            ")
    print("-"*86)
    print(f" {'Nombre Completo':<35} | {'Documento':<23} | {'Parentesco':<13} | {'Grupo':<9}")
    print("-"*86)
    
    for member in members:
        nombre = member["nombre"][:34]
        doc = f"{member['tipo_documento'][:5]} {member['numero_documento']}"[:22]
        parentesco = member["parentesco"][:12]
        sisben = member["sisben"][:8]
        print(f" {nombre:<35} | {doc:<23} | {parentesco:<13} | {sisben:<9}")
        
    print("="*86 + "\n")

if __name__ == '__main__':
    # Default search parameters (Cédula 1007299001 from user's cURL)
    DEFAULT_DOC = "1007299001"
    DEFAULT_TYPE = "3" # CC
    
    print("Iniciando DNP RUI Scraper Client...")
    client = DNPApiClient()
    
    # Allow command line overrides
    doc_num = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DOC
    doc_type = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_TYPE
    
    # Run query
    result = client.query_rui(doc_num, doc_type)
    
    # Present results
    print_result_table(result)
