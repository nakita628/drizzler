import { defineRelations } from "drizzle-orm";

import { cartTable } from "#/adapter/secondary/persistence/rdb/schema/cart.sql.js";
import { cartItemTable } from "#/adapter/secondary/persistence/rdb/schema/cartItem.sql.js";
import { customerTable } from "#/adapter/secondary/persistence/rdb/schema/customer.sql.js";
import { orderTable } from "#/adapter/secondary/persistence/rdb/schema/order.sql.js";
import { orderItemTable } from "#/adapter/secondary/persistence/rdb/schema/orderItem.sql.js";
import { productTable } from "#/adapter/secondary/persistence/rdb/schema/product.sql.js";

// Relations v2: what the queries join on. Only cart_item → cart and order_item → order are
// foreign keys in the database; the rest are drawn dashed.
const relations = defineRelations(
  { customerTable, productTable, cartTable, cartItemTable, orderTable, orderItemTable },
  (r) => ({
    customerTable: {
      cart: r.one.cartTable(),
      orders: r.many.orderTable(),
    },
    cartTable: {
      // The cart's key is its customer's, so a customer has at most one cart: a one-to-one.
      customer: r.one.customerTable({
        from: r.cartTable.customerId,
        to: r.customerTable.customerId,
      }),
      items: r.many.cartItemTable(),
    },
    cartItemTable: {
      cart: r.one.cartTable({ from: r.cartItemTable.customerId, to: r.cartTable.customerId }),
      product: r.one.productTable({
        from: r.cartItemTable.productId,
        to: r.productTable.productId,
        optional: false,
      }),
    },
    orderTable: {
      customer: r.one.customerTable({
        from: r.orderTable.customerId,
        to: r.customerTable.customerId,
      }),
      items: r.many.orderItemTable(),
    },
    orderItemTable: {
      order: r.one.orderTable({ from: r.orderItemTable.orderId, to: r.orderTable.orderId }),
      product: r.one.productTable({
        from: r.orderItemTable.productId,
        to: r.productTable.productId,
      }),
    },
  }),
);

export { relations };
