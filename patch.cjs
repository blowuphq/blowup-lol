const fs = require('fs');
const file = fs.readFileSync('tests/webhook.test.ts', 'utf-8');

const patched = file.replace(
  /'whsec_test_suite_secret'/,
  "'whsec_NDIzNDIzNDIzNDIzNDIzNDIzNDIzNDIz'"
);
fs.writeFileSync('tests/webhook.test.ts', patched);
