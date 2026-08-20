const handler = require('./api/query.js');

const req = {
  method: 'POST',
  body: {
    pNumDoc: '1027951245',
    pTipDoc: '3',
    simulatedDemo: false
  }
};

const res = {
  status: function(code) {
    console.log('STATUS:', code);
    return this;
  },
  json: function(data) {
    console.log('JSON:', JSON.stringify(data, null, 2));
    return this;
  },
  setHeader: function(name, val) {
    console.log('HEADER:', name, '=', val);
  },
  end: function() {
    console.log('END');
  }
};

handler(req, res).catch(err => {
  console.error('HANDLER ERROR:', err);
});
