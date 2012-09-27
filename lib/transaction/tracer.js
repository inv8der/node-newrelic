'use strict';

var path  = require('path')
  , State = require(path.join(__dirname, 'tracer', 'state'))
  ;

/**
 * EXECUTION TRACER
 *
 * One instance of this class exists per transaction, with the state
 * representing the current context shared between multiple instances.
 *
 * The transaction tracer works by wrapping either the generator functions
 * that asynchronously handle incoming requests (via
 * Tracer.transactionProxy and Tracer.segmentProxy) or direct function
 * calls in the form of callbacks (via Tracer.callbackProxy).
 *
 * In both cases, the wrappers exist to set up the execution context for
 * the wrapped functions. The context is effectively global, and works in
 * a manner similar to Node 0.8's domains, by explicitly setting up and
 * tearing down the current transaction / segment / call around each
 * wrapped function's invocation. It relies upon the fact that Node is
 * single-threaded, and requires that each entry and exit be paired
 * appropriately so that the context is left in its proper state.
 *
 * This version is optimized for production. For debugging purposes,
 * use transaction/tracer/debug.js.
 */
function Tracer(agent, context) {
  if (!agent) throw new Error("Must be initialized with an agent.");
  if (!context) throw new Error("Must include shared context.");

  this.numTransactions = 0;
  this.agent           = agent;
  this.context         = context;
}

/**
 * Use transactionProxy to wrap a closure that is a top-level handler that is
 * meant to originate transactions. This is meant to wrap the first half of
 * async calls, not their callbacks.
 *
 * @param {Function} handler Generator to be proxied.
 * @returns {Function} Proxied function.
 */
Tracer.prototype.transactionProxy = function (handler) {
  var self = this;
  return function wrapTransactionInvocation() {
    var transaction = self.agent.createTransaction();

    var state = new State(transaction, transaction.getTrace().root, handler);
    self.context.enter(state);
    var returned = handler.apply(this, arguments);
    self.context.exit(state);

    return returned;
  };
};

/**
 * Use segmentProxy to wrap a closure that is a top-level handler that is
 * meant to participate in an existing transaction. Unlike transactionProxy,
 * it will not create new transactions. This is meant to wrap the first
 * half of async calls, not their callbacks.
 *
 * @param {Function} handler Generator to be proxied.
 * @returns {Function} Proxied function.
 */
Tracer.prototype.segmentProxy = function (handler) {
  var self = this;
  return function wrapSegmentInvocation() {
    // don't implicitly create transactions
    var state = self.context.state;
    if (!state) return handler.apply(this, arguments);

    state = new State(state.transaction, state.segment, handler);
    self.context.enter(state);
    var returned = handler.apply(this, arguments);
    self.context.exit(state);

    return returned;
  };
};

/**
 * Use callbackProxy to wrap a closure that may invoke subsidiary functions that
 * want access to the current transaction. When called, it sets up the correct
 * context before invoking the original function (and tears it down afterwards).
 *
 * Proxying of individual calls is only meant to be done within the scope of
 * an existing transaction.
 *
 * @param {Function} handler Function to be proxied on invocation.
 * @returns {Function} Proxied function.
 */
Tracer.prototype.callbackProxy = function (handler) {
  // don't implicitly create transactions
  var state = this.context.state;
  if (!state) return handler;

  var self = this;
  return function wrapCallbackInvocation() {
    state = new State(state.transaction, state.segment, handler);
    self.context.enter(state);
    var returned = handler.apply(this, arguments);
    self.context.exit(state);

    return returned;
  };
};

module.exports = Tracer;