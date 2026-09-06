// Receipt & Invoice Intelligence V1 — pure core tests, validated against a
// SANITIZED fixture whose STRUCTURE mirrors a real Panama FE electronic invoice
// (rContFe > xFe > rFE default-namespace; gEmis > gRucEmi; gItem > gPrecios &
// gITBMSItem; gTot/dTotDesc; gFormaPago; multiple items; xProtFe > … > dCufe).
// ALL values are fictional. Privacy-sensitive elements (recipient email, phone,
// coordinates, QR/JWT, signature, X509) are INCLUDED to prove they are IGNORED.
//
// Run (where Node exists) from repo root:  node tests/receiptInvoice.test.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

// --- SANITIZED real-structure Panama FE fixture (fictional values only) -------
const REAL_STRUCT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rContFe xmlns="http://dgi-fep.mef.gob.pa">
  <xFe>
    <rFE xmlns="http://dgi-fep.mef.gob.pa">
      <dId>FE-QR-JWT-DO-NOT-PARSE-eyJhbGciOiJSUzI1NiJ9.PAYLOAD.SIGNATURE</dId>
      <gDGen>
        <dNroDF>0000123</dNroDF>
        <dPtoFacDF>001</dPtoFacDF>
        <dFechaEm>2026-08-30T14:35:02-05:00</dFechaEm>
        <gEmis>
          <gRucEmi>
            <dTipoRuc>2</dTipoRuc>
            <dRuc>155999999-2-2099</dRuc>
            <dDV>55</dDV>
          </gRucEmi>
          <dNombEm>TEST SUPERMARKET PANAMA S.A.</dNombEm>
          <dSucEm>0001</dSucEm>
          <dDirecEm>Via Fictional 123</dDirecEm>
          <dTfnEm>60000000</dTfnEm>
          <dCoordEm>0.0,0.0</dCoordEm>
        </gEmis>
        <gDatRec>
          <dCorElectRec>should-not-parse@example.com</dCorElectRec>
        </gDatRec>
      </gDGen>
      <gItem>
        <dSecItem>1</dSecItem>
        <dDescProd>Crispy Strips</dDescProd>
        <dCodProd>CS-01</dCodProd>
        <dCantCodInt>2</dCantCodInt>
        <gPrecios>
          <dPrUnit>4.50</dPrUnit>
          <dPrUnitDesc>0.00</dPrUnitDesc>
          <dPrItem>9.00</dPrItem>
          <dValTotItem>9.00</dValTotItem>
        </gPrecios>
        <gITBMSItem>
          <dTasaITBMS>01</dTasaITBMS>
          <dValITBMS>0.63</dValITBMS>
        </gITBMSItem>
      </gItem>
      <gItem>
        <dSecItem>2</dSecItem>
        <dDescProd>Biscuits</dDescProd>
        <dCodProd>BS-02</dCodProd>
        <dCantCodInt>1</dCantCodInt>
        <gPrecios>
          <dPrUnit>1.79</dPrUnit>
          <dValTotItem>1.79</dValTotItem>
        </gPrecios>
        <gITBMSItem>
          <dTasaITBMS>01</dTasaITBMS>
          <dValITBMS>0.12</dValITBMS>
        </gITBMSItem>
      </gItem>
      <gTot>
        <dTotNeto>10.79</dTotNeto>
        <dTotITBMS>0.75</dTotITBMS>
        <dTotDesc>1.00</dTotDesc>
        <dVTot>10.54</dVTot>
        <dTotRec>10.54</dTotRec>
        <dNroItems>2</dNroItems>
        <gFormaPago>
          <iFormaPago>02</iFormaPago>
          <dVlrCuota>10.54</dVlrCuota>
        </gFormaPago>
      </gTot>
    </rFE>
  </xFe>
  <xProtFe>
    <rProtFe>
      <gInfFE>
        <dCufe>FE0155999999SANITIZEDCUFE0000123</dCufe>
      </gInfFE>
    </rProtFe>
  </xProtFe>
  <dQRCode>https://dgi-fep.mef.gob.pa/Consultas/FacturasPorQR?chFE=SHOULD-NOT-PARSE</dQRCode>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <X509Certificate>SHOULDNOTPARSEBASE64CERT</X509Certificate>
    <X509SubjectName>CN=Should Not Parse</X509SubjectName>
  </Signature>
</rContFe>`;

try {
  const RI = await vite.ssrLoadModule('/src/lib/receiptIntelligence.js');
  const {
    parsePanamaInvoiceXml, normalizeReceipt, sanitizeReceiptImageResult,
    matchReceiptToTransactions, receiptFingerprint, receiptAnalyticsPayload,
    isHighConfidenceMatch,
  } = RI;

  const inv = parsePanamaInvoiceXml(REAL_STRUCT_XML);

  // A. default namespace parsed.
  ok('A: default-namespace rFE parsed', inv && inv.legalEntityName === 'TEST SUPERMARKET PANAMA S.A.');
  // B. nested gRucEmi/dRuc parsed.
  ok('B: nested gRucEmi/dRuc parsed', inv.taxId === '155999999-2-2099');
  // C. dSucEm parsed as branch code.
  ok('C: dSucEm branch code parsed', inv.branchCode === '0001');
  // D. dNroDF invoice number parsed.
  ok('D: dNroDF invoice number parsed', inv.invoiceNumber === '0000123');
  // E. dFechaEm date + embedded time parsed.
  ok('E: dFechaEm date parsed', inv.transactionDate === '2026-08-30');
  ok('E2: dFechaEm embedded time parsed', inv.transactionTime === '14:35:02');
  // F. dCantCodInt quantity.
  ok('F: dCantCodInt quantity parsed', inv.lineItems[0].quantity === 2 && inv.lineItems[1].quantity === 1);
  // G. nested gPrecios/dPrUnit.
  ok('G: nested gPrecios/dPrUnit parsed', inv.lineItems[0].unitPrice === 4.5 && inv.lineItems[1].unitPrice === 1.79);
  // H. nested gPrecios/dValTotItem.
  ok('H: nested gPrecios/dValTotItem parsed', inv.lineItems[0].lineTotal === 9 && inv.lineItems[1].lineTotal === 1.79);
  // I. gITBMSItem/dValITBMS.
  ok('I: nested gITBMSItem/dValITBMS parsed', inv.lineItems[0].taxAmount === 0.63 && inv.lineItems[1].taxAmount === 0.12);
  // J. dTotNeto captured as subtotal (pre-discount).
  ok('J: dTotNeto subtotal captured', inv.subtotal === 10.79);
  // K. dTotDesc captured as discountTotal.
  ok('K: dTotDesc discountTotal captured', inv.discountTotal === 1.00);
  // L. dVTot captured as final total (NOT dTotNeto).
  ok('L: dVTot final total captured (not subtotal)', inv.total === 10.54 && inv.total !== inv.subtotal);
  ok('L2: subtotal !== total - tax (discount intervenes)', Math.abs(inv.subtotal - (inv.total - inv.tax)) > 0.001);
  ok('tax: dTotITBMS captured', inv.tax === 0.75);
  // M. multiple gItem entries preserved.
  ok('M: all line items preserved', inv.lineItems.length === 2 && inv.lineItems[0].description === 'Crispy Strips' && inv.lineItems[1].description === 'Biscuits' && inv.lineItems[0].productCode === 'CS-01');
  // N. gFormaPago parsed as code + amount, no invented label.
  ok('N: payment code+amount, no guessed label', inv.paymentMethodCode === '02' && inv.paymentAmount === 10.54 && (inv.paymentMethod == null || inv.paymentMethod === undefined));
  // documentId = CUFE (not dId QR/JWT).
  ok('docId: dCufe used, dId QR/JWT NOT used as documentId', inv.documentId === 'FE0155999999SANITIZEDCUFE0000123');

  // O–Q privacy: sensitive values must NOT appear anywhere in the normalized object.
  const dump = JSON.stringify(inv);
  ok('O: QR/JWT (dId/dQRCode) ignored', !/JWT|eyJ|FacturasPorQR|SHOULD-NOT-PARSE/.test(dump));
  ok('P: Signature/X509 ignored', !/BASE64CERT|X509|Should Not Parse/.test(dump));
  ok('Q: recipient email ignored', !/should-not-parse@example.com/.test(dump));
  ok('Q2: issuer phone + coordinates ignored', !/60000000/.test(dump) && !/0\.0,0\.0/.test(dump));

  // R. malformed XML still safe.
  ok('R: garbage rejected', parsePanamaInvoiceXml('not xml { json:true }') === null);
  ok('R2: no anchor fields rejected', parsePanamaInvoiceXml('<rFE><foo>bar</foo></rFE>') === null);
  ok('R3: empty/null rejected', parsePanamaInvoiceXml('') === null && parsePanamaInvoiceXml(null) === null);
  // S. XXE protections unchanged.
  ok('S: DOCTYPE/ENTITY (XXE) rejected', parsePanamaInvoiceXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><rFE><dVTot>1</dVTot></rFE>') === null);

  // T. XML parsing performs no network/Gemini call.
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network allowed'); };
  let threw = false;
  try { parsePanamaInvoiceXml(REAL_STRUCT_XML); } catch { threw = true; }
  globalThis.fetch = savedFetch;
  ok('T: XML parser makes no network/Gemini call', threw === false);

  // Missing optionals safe.
  const minimal = parsePanamaInvoiceXml('<rFE xmlns="http://dgi-fep.mef.gob.pa"><gDGen><gEmis><dNombEm>Solo Nombre</dNombEm></gEmis></gDGen><gTot><dVTot>5.00</dVTot></gTot></rFE>');
  ok('optional-safe: minimal invoice parses', minimal && minimal.total === 5 && minimal.legalEntityName === 'Solo Nombre' && minimal.discountTotal === undefined);

  // Image mode schema + card-digit stripping.
  const img = sanitizeReceiptImageResult({
    merchantDisplayName: 'KFC VISA **** 1234', total: 11.54, tax: 0.75, transactionDate: '08/30/2026',
    paymentMethod: 'VISA ****1234', lineItems: [{ description: 'Combo x1234567890123', lineTotal: 11.54 }],
  });
  ok('image: normalized + US date', img && img.sourceType === 'image' && img.total === 11.54 && img.transactionDate === '2026-08-30');
  ok('image: card digits stripped', !/1234/.test(img.merchantDisplayName) && !/\d{13,}/.test(img.lineItems[0].description || ''));

  // Matching (unchanged behavior).
  const receipt = normalizeReceipt({ sourceType: 'image', merchantDisplayName: 'KFC', total: 11.54, transactionDate: '2026-08-30' });
  const txns = [
    { id: 'exact', merchant: 'KFC 0326', amount: -11.54, date: '2026-08-30' },
    { id: 'dateoff', merchant: 'KFC 0326', amount: -11.54, date: '2026-08-28' },
    { id: 'merchoff', merchant: 'FERRETERIA XYZ', amount: -11.54, date: '2026-08-30' },
  ];
  const cands = matchReceiptToTransactions(receipt, txns, { windowDays: 2 });
  ok('match: exact scores highest + high-confidence flag', cands[0].transactionId === 'exact' && isHighConfidenceMatch(cands[0]));
  ok('match: out-of-window excluded', matchReceiptToTransactions(receipt, [{ id: 'far', merchant: 'KFC', amount: -11.54, date: '2026-09-15' }], { windowDays: 2 }).length === 0);

  // Fingerprint stable + discount-aware total distinguishes.
  ok('fingerprint: stable across merchant-name variants', receiptFingerprint(receipt) === receiptFingerprint(normalizeReceipt({ merchantDisplayName: 'KFC 0326', total: 11.54, transactionDate: '2026-08-30' })));

  // Analytics carries no contents.
  const ap = receiptAnalyticsPayload(inv, { matched: true });
  ok('analytics: keys are counts/flags only', Object.keys(ap).sort().join(',') === 'document_type,has_tax,line_item_count,matched,source_type');
  ok('analytics: no merchant/amount/ruc/contents', !/SUPERMARKET|10.54|155999999|Crispy/.test(JSON.stringify(ap)));

  // U. /api unchanged.
  ok('U: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  console.log(`\nReceipt & invoice tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}
