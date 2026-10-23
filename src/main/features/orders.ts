// Feature "orders": the signed-in user's own orders, sales and money (OAuth
// transactions_r / transactions_w). getShopReceipts, getShopReceipt,
// updateShopReceipt, createReceiptShipment, getShopReceiptTransactionsBy
// Shop/Receipt/Listing, getShopReceiptTransaction, getListingsByShopReceipt,
// getPayments, getShopPaymentByReceiptId, getShopPaymentAccountLedgerEntries,
// getShopPaymentAccountLedgerEntry, getPaymentAccountLedgerEntryPayments.
// The calls live in orders/api.ts, the mapping in orders/map.ts, the MCP tools
// in orders/mcp.ts.

import { idArg, ownShop } from './common'
import {
  READ,
  WRITE,
  getOrder,
  ledger,
  ledgerEntry,
  ledgerPayments,
  listOrders,
  listingSales,
  orderListings,
  orderPayments,
  parseOrderFilters,
  parseOrderUpdate,
  parseShipment,
  periodArgs,
  saleById,
  shipOrder,
  shipmentError,
  shopSales,
  updateOrder
} from './orders/api'
import { orderTools } from './orders/mcp'
import type { Feature } from './types'

export const ordersFeature: Feature = {
  id: 'orders',
  actions: {
    /** {…OrderFilters} → OrdersPage */
    list: (args, ctx) => listOrders(ctx.client, ownShop(ctx.authStatus, READ), parseOrderFilters(args)),
    /** {receiptId} → Order */
    get: (args, ctx) => getOrder(ctx.client, ownShop(ctx.authStatus, READ), idArg(args, 'receiptId')),
    /** {receiptId, wasShipped?, wasPaid?} → Order */
    update: (args, ctx) =>
      updateOrder(ctx.client, ownShop(ctx.authStatus, WRITE), idArg(args, 'receiptId'), parseOrderUpdate(args)),
    /** {receiptId, carrier?, trackingCode?, noteToBuyer?, sendBcc?} → Order (Etsy emails the buyer) */
    ship: async (args, ctx) => {
      const shopId = ownShop(ctx.authStatus, WRITE)
      try {
        return await shipOrder(ctx.client, shopId, idArg(args, 'receiptId'), parseShipment(args))
      } catch (e) {
        throw shipmentError(e)
      }
    },
    /** {receiptId} → MyListing[] (the order's listings as they are now) */
    listings: (args, ctx) => orderListings(ctx.client, ownShop(ctx.authStatus, READ), idArg(args, 'receiptId')),
    /** {receiptId} → OrderPayment[] */
    payments: (args, ctx) => orderPayments(ctx.client, ownShop(ctx.authStatus, READ), idArg(args, 'receiptId')),
    /** {minCreated, maxCreated} → LedgerPage */
    ledger: (args, ctx) => {
      const shopId = ownShop(ctx.authStatus, READ)
      const p = periodArgs(args, true)
      return ledger(ctx.client, shopId, p.minCreated, p.maxCreated)
    },
    /** {entryId} → LedgerEntry */
    ledgerEntry: (args, ctx) => ledgerEntry(ctx.client, ownShop(ctx.authStatus, READ), idArg(args, 'entryId')),
    /** {entryId} → OrderPayment[] */
    ledgerPayments: (args, ctx) => ledgerPayments(ctx.client, ownShop(ctx.authStatus, READ), [idArg(args, 'entryId')]),
    /** {transactionId} → OrderItem */
    sale: (args, ctx) => saleById(ctx.client, ownShop(ctx.authStatus, READ), idArg(args, 'transactionId')),
    /** {listingId} → ListingSales */
    listingSales: (args, ctx) => listingSales(ctx.client, ownShop(ctx.authStatus, READ), idArg(args, 'listingId')),
    /** {minCreated?, maxCreated?} → SalesSummary (from the period's orders) */
    sales: (args, ctx) => {
      const shopId = ownShop(ctx.authStatus, READ)
      return shopSales(ctx.client, shopId, periodArgs(args))
    }
  },
  mcpTools: orderTools
}
