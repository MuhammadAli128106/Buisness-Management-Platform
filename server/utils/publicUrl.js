// Base URL the outside world reaches us on (webhooks, payment links). PUBLIC_URL wins.
function publicBase(req) {
  return (process.env.PUBLIC_URL || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:8080')).replace(/\/+$/, '');
}
module.exports = { publicBase };
