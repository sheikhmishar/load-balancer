import express from 'express'
import socketIo from 'socket.io'
import socketIoClient from 'socket.io-client'

declare global {
  namespace SocketIO {
    interface Socket {
      username: string
    }
  }
  namespace Express {
    interface ErrorRequestHandler extends express.ErrorRequestHandler {}
    interface RequestHandler extends express.RequestHandler {}
    interface Request {
      username: SocketIO.Socket
    }
    interface Response {
      username: SocketIO.Socket
    }
  }
  interface Window {
    io: SocketIOClientStatic
  }
}
