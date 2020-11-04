const express = require('express')
const debug = require('debug')
const http = require('http')
const socketIO = require('socket.io')

const trackerDebug = debug('TRACKER')
const trackerIoDebug = debug('TRACKER:IO')
const trackerApp = express()
const trackerServer = http.createServer(trackerApp)
const trackerIo = socketIO(trackerServer, { path: '/list', serveClient: false })
const trackerChannel = trackerIo.of('/list')

/** @type {SocketIO.Socket[]}} */
let upstreamSockets = [] // TODO: const

// Subscribers
/** @type {{[x:string]:string[]}} */
const subsTracker = {}

/** @param {SocketIO.Socket} upstream */
const onTrackerConnection = upstream => {
  upstreamSockets.push(upstream)
  subsTracker[upstream.id] = []
  trackerIoDebug('SERVER SOCKET', upstream.id, 'CONNECTED TO TRACKER')

  upstream.on('validate', username => {
    let isValid = true
    for (let upstream in subsTracker)
      if (subsTracker[upstream].includes(username)) isValid = false

    upstream.emit('validate', isValid)
  })
  // TODO: join_client
  upstream.on('join', username => {
    subsTracker[upstream.id].push(username)
    for (let socket of upstreamSockets)
      if (socket.id !== upstream.id) socket.emit('join', username)

    trackerIoDebug(username, 'CONNECTED TO SERVER', upstream.id)
  })
  upstream.on('message', message => {
    for (let socket of upstreamSockets)
      if (socket.id !== upstream.id) socket.emit('message', message)
    trackerIoDebug(message, upstream.id)
  })
  upstream.on('leave', username => {
    subsTracker[upstream.id] = subsTracker[upstream.id].filter(
      _ => _ !== username
    )
    for (let socket of upstreamSockets)
      if (socket.id !== upstream.id) socket.emit('leave', username)
    trackerIoDebug(username, 'DISCONNECTED FROM SERVER', upstream.id)
  })
  upstream.on('disconnect', () => {
    upstreamSockets = upstreamSockets.filter(_ => _ !== upstream)
    subsTracker[upstream.id].forEach(username =>
      upstreamSockets.forEach(_ => _.emit('leave', username))
    )
    delete subsTracker[upstream.id]
    trackerIoDebug('SERVER SOCKET', upstream.id, 'DISCONNECTED FROM TRACKER')
  })
}
trackerChannel.on('connection', onTrackerConnection)

let PORT = 80
trackerServer
  .listen(80, '127.0.0.1')
  .on('listening', () => trackerDebug('Server', trackerServer.address()))
  // @ts-ignore
  .on('error', ({ code }) => {
    if (code === 'EADDRINUSE') {
      trackerDebug(`Port ${PORT} in use. Retry with port ${++PORT}...`)
      trackerServer.close()
    }
  })
