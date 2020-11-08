const express = require('express')
const debug = require('debug')
const chalk = require('chalk')
const http = require('http')
const socketIO = require('socket.io')
const { createProxyMiddleware } = require('http-proxy-middleware')

const lbDebug = debug('loadBalancer')
const lbIoDebug = debug('loadBalancer:io')
const proxyMiddlewareDebug = debug('proxyMiddleware')

/**
 * `Step 1:` Run this server in seperate terminal:
 * ```bash
 * node load-balancer.js
 * ```
 */
const lbApp = express()
const lbServer = http.createServer(lbApp)
const lbIo = socketIO(lbServer, { path: '/list', serveClient: false })
/**
 * `Step 2:` Any upstream server must connect to this channel via:
 * ```javascript
 * const io = require('socket-io-client')
 * const lbSocket = io.connect('http://<ip:port of load balancer>/list', { path: '/list' })
 * ```
 */
const subslistChannel = lbIo.of('/list')

// Subscribers
/** @type {{
      [upstreamId: string]: {
        address?: string,
        proxyMiddleware?: Express.RequestHandler,
        subs: string[]
      }
    }} */
const subsTracker = {}

/** @param {Object<string, object>} obj */
const prettyJson = obj => JSON.stringify(obj, null, 4)

/** @type {import('express').ErrorRequestHandler} */
const proxyOnError = (err, req, res) => {
  lbDebug('ERR\n', chalk.red(prettyJson(err)))
  lbDebug('REQ\n', chalk.green(prettyJson(req.headers)))
  res.status(500).json({ message: '500 Upstream Error' })
}

const proxyLogProvider = _ => ({
  log: proxyMiddlewareDebug,
  debug: proxyMiddlewareDebug,
  info: proxyMiddlewareDebug,
  warn: proxyMiddlewareDebug,
  error: proxyMiddlewareDebug
})

/** @param {string} address */
const getProxyMiddleware = address =>
  // @ts-ignore
  createProxyMiddleware({
    target: address,
    preserveHeaderKeyCase: true,
    followRedirects: false,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: 'debug',
    onError: proxyOnError,
    logProvider: proxyLogProvider
  })

/** @param {SocketIO.Socket} socket // FIXME: always returns proxy address */
const getSocketAddr = socket => {
  lbIoDebug('handshake.headers', socket.handshake.headers)
  lbIoDebug('handshake.address', socket.handshake.address) // server Address
  lbIoDebug(
    'request.connection.remoteAddress',
    socket.request.connection.remoteAddress
  )
  lbIoDebug('conn.remoteAddress', socket.conn.remoteAddress) // if direct connection

  // Interesting, but not what I'm looking for
  lbIoDebug('request.connection._peername', socket.request.connection._peername)

  return '127.0.0.1:80'
}

/**
 * `Step 3:` As an upstream server connects to the channel, it gets added to upstream list in load balancer.
 * Now, the upstream server must emit a signal 'address' with his own ipv4 address and port via:
 * ```javascript
 * lbSocket.emit('address', '<ip:port of the upstream server itself>')
 * ```
 * Now, the load balancer knows to which IP and Port to pass request. Note that, it is recommended to emit
 * this signal after server starts with success. This is the minimum config required for load balancing.
 * If you have stateful servers to sync with each other, follow these steps:
 *
 * `Step 4:`
 * If you want to query if a user exists in any of the upstreams, emit 'subs_exists'
 * If you want to share joined subscriber username between upstream servers, emit 'join_subs'
 * If you want to share left subscriber username between upstream servers, emit 'leave_subs'
 * @param {SocketIO.Socket} upstream */
const onLbIoConnect = upstream => {
  subsTracker[upstream.id] = { subs: [] }
  lbIoDebug('SERVER SOCKET', upstream.id, 'CONNECTED')

  upstream.on('address', address => {
    subsTracker[upstream.id].address = address
    subsTracker[upstream.id].proxyMiddleware = getProxyMiddleware(address)
    lbIoDebug('SERVER SOCKET', upstream.id, 'ADDRESS', address)
  })

  upstream.on('disconnect', () => {
    delete subsTracker[upstream.id]
    lbIoDebug('SERVER SOCKET', upstream.id, 'DISCONNECTED')
  })

  upstream.on('subs_exists', username => {
    let subsExists = false
    for (let upstream in subsTracker)
      if (subsTracker[upstream].subs.includes(username)) subsExists = true
    upstream.emit('subs_exists', subsExists)
  })

  upstream.on('join_subs', username => {
    subsTracker[upstream.id].subs.push(username)
    lbIoDebug(username, 'CONNECTED TO SERVER', upstream.id)
  })

  upstream.on('leave_subs', username => {
    subsTracker[upstream.id].subs = subsTracker[upstream.id].subs.filter(
      subsName => subsName !== username
    )
    lbIoDebug(username, 'DISCONNECTED FROM SERVER', upstream.id)
  })
}
subslistChannel.on('connection', onLbIoConnect)

/** @param {string} subsName */
const findSubsAddr = subsName => {
  for (let upstream in subsTracker)
    if (subsTracker[upstream].subs.includes(subsName))
      return subsTracker[upstream].address
  return null
}

let currentUpstream = 0
/** @type {Express.RequestHandler} */
const loadBalancer = (req, res, next) => {
  lbDebug(req.originalUrl)
  // lbDebug(req.connection.address())
  // const subdomain = req.subdomains[0]
  // proxyMiddlewares[findSubsAddr(subdomain)].middleware(req, res, next)

  const upstreamIds = Object.keys(subsTracker),
    upstreamId = upstreamIds[currentUpstream++ % upstreamIds.length]

  if (upstreamId) subsTracker[upstreamId].proxyMiddleware(req, res, next)
  else res.status(500).json({ message: 'Upstream Not Found' })
}
lbApp.use(loadBalancer)

lbServer
  // use port 80 if you are not using reverse proxy
  .listen(5100, '127.0.0.1')
  .on('listening', () => lbDebug('Server', lbServer.address()))
  .on('error', err => {
    // @ts-ignore
    if (err.code === 'EADDRINUSE') {
      lbDebug(`Port ${lbServer.address()} in use. Retry with another one`)
      lbServer.close()
    }
  })
