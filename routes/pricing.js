// Shared server-side pricing math, mirroring public/js/schedule-builder.js.
// Used anywhere totals need to be computed authoritatively from raw item fields —
// Invoice Creator, Purchase Orders, and the cross-project Business Overview rollup.

function clientPrice(it) { return (it.tradeCost || 0) + (it.markupAmt || 0); }
function clientShipping(it) { return (it.shippingCost || 0) + (it.shippingMarkupAmt || 0); }
function receivingCostTotal(it) { return (it.receivingCost || 0) * (it.qty || 0); }
function clientReceiving(it) { return receivingCostTotal(it) * (1 + (it.receivingMarkupPct || 0) / 100); }
function lineTotalClient(it) { return clientPrice(it) * (it.qty || 0); }
function tradeTaxAmt(it) { return ((it.tradeCost || 0) * (it.qty || 0)) * (it.tradeTaxPct || 0) / 100; }
function clientTaxAmt(it) { return lineTotalClient(it) * (it.clientTaxPct || 0) / 100; }
function invoiceLineTotal(it) { return lineTotalClient(it) + clientTaxAmt(it) + clientShipping(it) + clientReceiving(it); }
function costTotal(it) {
  const tradeLineTotal = (it.tradeCost || 0) * (it.qty || 0);
  const tradeTax = tradeLineTotal * (it.tradeTaxPct || 0) / 100;
  return tradeLineTotal + tradeTax + (it.shippingCost || 0) + receivingCostTotal(it);
}
function totalCostAllIn(it) { return (it.tradeCost || 0) * (it.qty || 0) + tradeTaxAmt(it) + (it.shippingCost || 0) + receivingCostTotal(it); }
function totalClientAllIn(it) { return lineTotalClient(it) + clientTaxAmt(it) + clientShipping(it) + clientReceiving(it); }

module.exports = {
  clientPrice, clientShipping, receivingCostTotal, clientReceiving, lineTotalClient,
  tradeTaxAmt, clientTaxAmt, invoiceLineTotal, costTotal, totalCostAllIn, totalClientAllIn
};
