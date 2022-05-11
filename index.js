/*!
 * xprezzo-connect
 * Copyright(c) Cloudgen Wong <cloudgen.wong@gmail.com>
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */
const debug = require('xprezzo-debug')('xprezzo:connect')
const EventEmitter = require('events').EventEmitter
const finalhandler = require('xprezzo-finalhandler')
const mixin = require('xprezzo-mixin')
const http = require('http')
const parseUrl = require('parseurl')

let env = process.env.NODE_ENV || 'development'

/* istanbul ignore next */
let defer = typeof setImmediate === 'function'
    ? setImmediate
    : (fn) => { 
        process.nextTick(fn.bind.apply(fn, arguments)) 
}

/**
 * Invoke a route handle.
 * @private
 */
let call = (handle, route, err, req, res, next) => {
    let arity = handle.length
    let error = err
    let hasError = Boolean(err)
    debug('%s %s : %s', handle.name || '<anonymous>', route, req.originalUrl)
    try {
        if (hasError && arity === 4) {
            // error-handling middleware
            handle(err, req, res, next)
            return;
        } else if (!hasError && arity < 4) {
            // request-handling middleware
            handle(req, res, next)
            return
        }
    } catch (e) {
    // replace the error
        error = e
    }
    // continue
    next(error)
}

/**
 * Log error using console.error.
 *
 * @param {Error} err
 * @private
 */

let logerror = (err) => {
    if (env !== 'test') 
        console.error(err.stack || err.toString())
}

/**
 * Get get protocol + host for a URL.
 *
 * @param {string} url
 * @private
 */

let getProtohost = (url) => {
    if (url.length === 0 || url[0] === '/') {
      return undefined
    }

    let fqdnIndex = url.indexOf('://')

    return fqdnIndex !== -1 && url.lastIndexOf('?', fqdnIndex) === -1
      ? url.substr(0, url.indexOf('/', 3 + fqdnIndex))
      : undefined
}

/**
 * Create a new connect server.
 *
 * @return {function}
 * @public
 */
let createServer = () => {
    debug('start');
    let app = (req, res, next) => { 
        app.handle(req, res, next)
    }
    mixin(app, proto, EventEmitter.prototype,{
      route : '/',
      stack : []
    });
    if(typeof app.init === 'function'){
        debug('call proto init()')
        app.init()
    }
    debug('done')
    return app
}

/**
 * Module variables.
 * @private
 */
let proto = {
    /**
     * Utilize the given middleware `handle` to the given `route`,
     * defaulting to _/_. This "route" is the mount-point for the
     * middleware, when given a value other than _/_ the middleware
     * is only effective when that segment is present in the request's
     * pathname.
     *
     * For example if we were to mount a function at _/admin_, it would
     * be invoked on _/admin_, and _/admin/settings_, however it would
     * not be invoked for _/_, or _/posts_.
     *
     * @param {String|Function|Server} route, callback or server
     * @param {Function|Server} callback or server
     * @return {Server} for chaining
     * @public
     */
    use : function (route, fn) {
        let handle = fn
        let path = route

        // default route to '/'
        if (typeof route !== 'string') {
            handle = route
            path = '/'
        }

        // wrap sub-apps
        if (typeof handle.handle === 'function') {
            let server = handle
            server.route = path
            handle = function (req, res, next) {
                server.handle(req, res, next)
            }
        }

        // wrap vanilla http.Servers
        if (handle instanceof http.Server) {
            handle = handle.listeners('request')[0];
        }

        // strip trailing slash
        if (path[path.length - 1] === '/') {
            path = path.slice(0, -1)
        }

        // add the middleware
        debug('use %s %s', path || '/', handle.name || 'anonymous')
        this.stack.push({ route: path, handle: handle })

        return this
    },

    /**
     * Handle server requests, punting them down
     * the middleware stack.
     *
     * @private
     */
    handle : function(req, res, out) {
        let index = 0
        let protohost = getProtohost(req.url) || ''
        let removed = ''
        let slashAdded = false
        let stack = this.stack

        // final function handler
        let done = out || finalhandler(req, res, {
            env: env,
            onerror: logerror
        })

        // store the original URL
        req.originalUrl = req.originalUrl || req.url

        let next = (err) => {
            if (slashAdded) {
                req.url = req.url.substr(1)
                slashAdded = false
            }

            if (removed.length !== 0) {
                req.url = protohost + removed + req.url.substr(protohost.length)
                removed = ''
            }

            // next callback
            let layer = stack[index++]

            // all done
            if (!layer) {
                defer(done, err)
                return
            }

            // route data
            let path = parseUrl(req).pathname || '/'
            let route = layer.route

            // skip this layer if the route doesn't match
            if (path.toLowerCase().substr(0, route.length) !== route.toLowerCase()) {
                return next(err)
            }

            // skip if route match does not border "/", ".", or end
            let c = path.length > route.length && path[route.length]
            if (c && c !== '/' && c !== '.') {
                return next(err)
            }

            // trim off the part of the url that matches the route
            if (route.length !== 0 && route !== '/') {
                removed = route
                req.url = protohost + req.url.substr(protohost.length + removed.length)

                // ensure leading slash
                if (!protohost && req.url[0] !== '/') {
                    req.url = '/' + req.url
                    slashAdded = true
                }
            }
            // call the layer handle
            call(layer.handle, route, err, req, res, next)
        }
        next()
    },

    /**
     * Listen for connections.
     *
     * This method takes the same arguments
     * as node's `http.Server#listen()`.
     *
     * HTTP and HTTPS:
     *
     * If you run your application both as HTTP
     * and HTTPS you may wrap them individually,
     * since your Connect "server" is really just
     * a JavaScript `Function`.
     *
     *      let connect = require('connect')
     *        , http = require('http')
     *        , https = require('https')
     *
     *      let app = connect()
     *
     *      http.createServer(app).listen(80)
     *      https.createServer(options, app).listen(443)
     *
     * @return {http.Server}
     * @api public
     */

    listen : function() {
        let server = http.createServer(this)
        return server.listen.apply(server, arguments)
    }
}


/**
 * Module exports.
 * @public
 */
module.exports = createServer
