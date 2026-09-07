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

  // =====================================================================
  // V1.1 — Panama DGI PDF (deterministic text parsing). Anonymized fixtures.
  // =====================================================================
  const { isPanamaDgiPdf, parsePanamaDgiPdfText } = RI;
  const RS = await vite.ssrLoadModule('/src/lib/receiptStore.js');
  const fs = await import('node:fs');
  const readSrc = (p) => fs.readFileSync(p, 'utf8');

  // NOTE: real Panama DGI PDFs, once run through unpdf, come back as ONE flat,
  // single-spaced string (no newlines) with the emisor/receptor columns
  // interleaved and Spanish long dates. These sanitized fixtures reproduce that
  // exact real structure (anonymized issuer + placeholder recipient; no real PDFs,
  // no real private data). Values chosen to mirror the two validated real files.

  // Layout B — school tuition. Ítem seq + código ("MENS PRIMARIA") + description
  // ("MENSUALIDAD (E)"); recipient columns present to prove they are excluded.
  const SCHOOL_PDF = 'DGI Comprobante Auxiliar de Factura Electrónica Documento: Factura de operación interna '
    + 'Sucursal/Punto: 0000/001 Fecha emisión: 03 de Septiembre de 2026 Número: 0000006408 '
    + 'Consulte por la clave de acceso en https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE: usando el CUFE: FE01SCHOOLSANITIZEDCUFE6408 '
    + 'Emisor Receptor Nombre: TEST SCHOOL PANAMA Tipo de receptor: Consumidor final Nombre: CLIENTE PRIVADO EJEMPLO '
    + 'Dirección: AVE EJEMPLO Dirección: OTRA DIRECCION RUC: 164-888-8062 DV: 23 Teléfono: 000-0000 '
    + 'RUC: 8-888-8888 DV: Teléfono: 0000-0000 Correo: privado@example.com Correo: otro@example.com '
    + 'Ítem Código Descripción Cantidad Unidad Precio unidad Impuestos Total ítem '
    + '1 MENS PRIMARIA MENSUALIDAD (E) 2.00 und 290.00 0.00 580.00 Cantidad Total de Ítems: 1 '
    + 'Desglose de impuestos (B/.) Tipo Monto Base Impuesto (E) Exento 0.00% 580.00 0.00 '
    + 'Totales (B/.) Subtotal sin impuestos 580.00 Impuestos 0.00 Total 580.00 Total de pago 580.00 '
    + 'Medios de Pago Tipo B/. Valor Observación Crédito 580.00';

  // Layout A — freight/service. Código-first (numeric "01"), no Ítem seq; includes
  // the ITBMS-breakdown "Total 0.00" that must NOT be read as the final total.
  const FREIGHT_PDF = 'DGI COMPROBANTE AUXILIAR DE FACTURA ELECTRÓNICA '
    + 'Nombre Emisor: TEST LOGISTICS PANAMA Ruc Emisor: 155-777-7777 DV: 11 Dirección Emisor: CALLE EJEMPLO '
    + 'Tipo de Receptor: Contribuyente Razón Social: OTRO CLIENTE PRIVADO Ruc: 7-777-7777 DV: 12 Dirección: OTRA DIRECCION '
    + 'Número: 0010006901 Fecha: 27 de agosto de 2026 Hora: 14:53:40 '
    + 'Consulte por la clave de acceso en https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE: FE01LOGISTICSSANITIZED099 '
    + 'Sucursal: 0001 Caja/Pto Fact: 002 '
    + 'Código Descripción Cantidad Unidad Valor Unitario % Impuesto Valor Total '
    + '01 FLETE CARGA AEREO 1.000000 und 16.20 0.00 16.20 Cantidad Items: 1 '
    + 'Desglose ITBMS Monto Base % Impuesto 16.20 EXENTO 0.00 Total 0.00 '
    + 'SubTotal 16.20 Monto Exento 16.20 Monto Gravado 0.00 Total Impuesto 0.00 Total Recibido 16.20 Total 16.20 '
    + 'Forma Pago Transf./Depósito a cta. Bancaria 16.20';

  const school = parsePanamaDgiPdfText(SCHOOL_PDF);
  const freight = parsePanamaDgiPdfText(FREIGHT_PDF);

  // A–E. Mobile input controls (asserted against the component source).
  const capSrc = readSrc('src/components/ReceiptCapture.jsx');
  ok('A: Take photo uses capture="environment"', /accept="image\/\*" capture="environment"/.test(capSrc));
  ok('B: Choose photo is image/* with NO capture', /accept="image\/\*" onChange=\{onImage\(photoChooseInput\)\}/.test(capSrc));
  ok('C: image accept correct', /accept="image\/\*"/.test(capSrc));
  ok('D: PDF input accepted', /accept="application\/pdf,\.pdf"/.test(capSrc));
  ok('E: XML input preserved', /accept="\.xml,text\/xml,application\/xml"/.test(capSrc));

  // F/G. DGI layout detection.
  ok('F: DGI layout A detected', isPanamaDgiPdf(FREIGHT_PDF) === true);
  ok('G: DGI layout B detected', isPanamaDgiPdf(SCHOOL_PDF) === true);
  ok('G2: arbitrary PDF text NOT classified as DGI', isPanamaDgiPdf('Just a random document with a total: 5.00') === false);

  // H/I. Merchants.
  ok('H: layout A merchant', freight && freight.legalEntityName === 'TEST LOGISTICS PANAMA');
  ok('I: layout B merchant', school && school.legalEntityName === 'TEST SCHOOL PANAMA');
  // J. RUC (issuer only — the FIRST RUC; recipient RUC excluded).
  ok('J: issuer RUC extracted', school.taxId === '164-888-8062' && freight.taxId === '155-777-7777');
  // K. date (Spanish long form -> ISO).
  ok('K: Spanish long date parsed', school.transactionDate === '2026-09-03' && freight.transactionDate === '2026-08-27');
  ok('K2: emission time parsed (Layout A)', freight.transactionTime === '14:53:40');
  // L. invoice number (leading zeros preserved).
  ok('L: invoice number', school.invoiceNumber === '0000006408' && freight.invoiceNumber === '0010006901');
  // M. branch (Layout B "0000/001"; Layout A "0001").
  ok('M: branch extracted', school.branchCode === '0000/001' && freight.branchCode === '0001');
  // N/O/P. subtotal/tax/total. Real defects fixed: final total (not breakdown
  // "Total 0.00") and tax (not "Subtotal sin impuestos 580.00").
  ok('N: subtotal', school.subtotal === 580 && freight.subtotal === 16.2);
  ok('O: tax (0, not the subtotal amount)', school.tax === 0 && freight.tax === 0);
  ok('P: final total (not breakdown/impuesto)', school.total === 580 && freight.total === 16.2);
  // Q. payment method (preserved as text, no guessed code mapping).
  ok('Q: payment method', school.paymentMethod === 'Crédito' && /Transf/.test(freight.paymentMethod));
  // R. line items.
  ok('R: line items parsed', school.lineItems.length === 1 && freight.lineItems.length === 1);
  // S. school item — qty/unit/total correct. NOTE: flat single-spaced text cannot
  // separate código ("MENS PRIMARIA") from descripción ("MENSUALIDAD (E)"), so the
  // description carries the combined string (documented flat-extraction limitation).
  ok('S: school item qty2 unit290 total580', school.lineItems[0].quantity === 2 && school.lineItems[0].unitPrice === 290 && school.lineItems[0].lineTotal === 580);
  ok('S2: school description reflects real flat extraction', school.lineItems[0].description === 'MENS PRIMARIA MENSUALIDAD (E)');
  ok('S3: school sourceType pdf + documentType invoice', school.sourceType === 'pdf' && school.documentType === 'invoice');
  // T. freight item — Layout A código-first captures productCode "01".
  ok('T: freight item FLETE qty1 unit16.20 total16.20 code01', freight.lineItems[0].description === 'FLETE CARGA AEREO' && freight.lineItems[0].quantity === 1 && freight.lineItems[0].unitPrice === 16.2 && freight.lineItems[0].lineTotal === 16.2 && freight.lineItems[0].productCode === '01');
  // U. recipient personal fields excluded (real two-column interleave).
  ok('U: recipient identity excluded (school)', !/CLIENTE PRIVADO|8-888-8888|privado@example.com|0000-0000/.test(JSON.stringify(school)));
  ok('U2: recipient identity excluded (freight)', !/OTRO CLIENTE|7-777-7777/.test(JSON.stringify(freight)));
  // V. text-readable PDF parse does not call the network/Gemini.
  const savedFetch2 = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network allowed'); };
  let pdfThrew = false;
  try { parsePanamaDgiPdfText(SCHOOL_PDF); } catch { pdfThrew = true; }
  globalThis.fetch = savedFetch2;
  ok('V: DGI PDF parse makes no network/Gemini call', pdfThrew === false);
  // W. malformed / non-DGI PDF text is safe.
  ok('W: non-DGI text -> null', parsePanamaDgiPdfText('lorem ipsum total 3.00') === null && parsePanamaDgiPdfText('') === null);
  // X. PDF size guard present in the component.
  ok('X: PDF size guard present', /MAX_PDF_BYTES/.test(capSrc) && /withinSize\(file, MAX_PDF_BYTES\)/.test(capSrc));
  // Y. image flow unchanged (still uses scanReceipt receipt_v1).
  ok('Y: image flow uses scanReceipt receipt_v1', /mode: 'receipt_v1'/.test(capSrc));
  // Z. XML flow unchanged (parser still handles the real structure — asserted above).
  ok('Z: XML flow preserved', typeof RI.parsePanamaInvoiceXml === 'function' && inv.total === 10.54);

  // AA/AB/AC. saveReceipt state mapping via an injected fake client.
  const fakeClient = (err) => ({ from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: err ? null : { id: 'r1' }, error: err }) }) }) }) });
  const okSave = await RS.saveReceipt(fakeClient(null), { receipt: school });
  ok('save ok path', okSave.ok === true && okSave.id === 'r1');
  const pending = await RS.saveReceipt(fakeClient({ code: '42P01', message: 'relation "transaction_receipts" does not exist' }), { receipt: school });
  ok('AA: missing table -> pendingMigration', pending.ok === false && pending.pendingMigration === true);
  const dup = await RS.saveReceipt(fakeClient({ code: '23505', message: 'duplicate key' }), { receipt: school });
  ok('AB: duplicate fingerprint -> duplicate', dup.ok === false && dup.duplicate === true);
  const other = await RS.saveReceipt(fakeClient({ code: '42501', message: 'permission denied' }), { receipt: school });
  ok('AC: unrelated DB error NOT masked as pending/duplicate', other.ok === false && !other.pendingMigration && !other.duplicate && other.reason === 'db_error');

  // AD. /api unchanged (V1.1 adds no endpoint).
  ok('AD: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  // U (legacy). /api unchanged.
  ok('U: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  console.log(`\nReceipt & invoice tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}
