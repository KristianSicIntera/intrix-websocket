import redis from 'redis'
import express from 'express'
import { WebSocketServer } from 'ws'
import url from 'url'
import paseto from 'paseto'
import { Server } from "socket.io"

Object.filter = (obj, predicate) => 
    Object.keys(obj)
          .filter( key => predicate(obj[key]) )
          .reduce( (res, key) => (res[key] = obj[key], res), {} )

console.clear()
const app = express()
const port = 8080
const redisChannelDelimiter = '/'

var env = process.env.NODE_ENV || 'dev'

const redisConfig =
  env == 'dev'
    ? {}
    : {
        socket: {
          host: 'redis',
          port: 6379
        },
        password: 'mypassword'
      }

console.log('redisConfig: ' + JSON.stringify(redisConfig, null, 4))

const redisClient = redis.createClient(redisConfig)


const socketio = new Server()
socketio.listen(5001)

const websocketClients = {}

app.get('/', (_req, res) => {
  res.send('[hello world]')
})

redisClient.on('error', err => {
  console.log('[Error] ' + err)
})

redisClient.connect().then(async () => {
  console.log('[successfully connected to redis]')
})

socketio.use((socket, next) => {
  const token = socket.handshake.query.token
  if (token){
    socket.token = token
    next()
  }
  else {
    next(new Error('Authentication error'))
  }    
})
.on('connection', setup)

async function setup(socket) {

  const uuid = socket.id
  const { token } = socket
  const tkn = await decodeToken(token)
  const {client_id: clientID, user_id: username} = tkn

  console.log("[CONNECTED]",{tkn})

  if (!websocketClients[clientID]) {
    websocketClients[clientID] = {}
  }

  if (!websocketClients[clientID][username]) {
    websocketClients[clientID][username] = {}
  }

  websocketClients[clientID][username][uuid] = {
    socket,
    route: '',
  }

  redisClient.pSubscribe(`in3x/${clientID}/user/*`, payload => {
    const socket = websocketClients[clientID][username][uuid].socket
    socket?.send(payload)
  })
  
  socket.on("disconnect", disconnect)
  socket.on('message', (payload) => {
    message(socket, payload, tkn)
  })
}

function disconnect(reason) {
  console.log("[DISCONECT]",{reason})
}

function message(socket, _payload, tkn) {

  console.log("[MESSAGE]",{_payload})
  
  const {client_id: clientID, user_id: username} = tkn
  const payload = JSON.parse(_payload)
  const uuid = socket.id

  switch (payload.type) {
    case 'route-change':

      const {route} = payload
      const {name, params, path} = route

      switch (name) {
        case 'classId':
          break
        case 'classId-instanceId':
          break
        case 'classId-instanceId-edit':
          break
      }
      
      const previousPath = websocketClients[clientID][username][uuid].route

      if (previousPath) {
        const previousChannel = `in3x/${clientID}/watch${previousPath}`
        redisClient.unsubscribe(previousChannel)
        console.log('[UN][SUBSCRIBE]', uuid , previousPath)
      }

      const channel = `in3x/${clientID}/watch${path}`

      websocketClients[clientID][username][uuid].route = path

      redisClient.subscribe(channel, payload => {
        const socket = websocketClients[clientID][username][uuid].socket
        socket?.send(payload)
      })

      console.log('[SUBSCRIBE]', uuid, path)
      break
  }
}

async function checkClients() {
  const redisClient2 = redis.createClient(redisConfig)
  await redisClient2.connect()
  let PUBSUB_CHANNELS = await redisClient2.PUBSUB_CHANNELS()
  console.log({PUBSUB_CHANNELS})
  redisClient2.disconnect()
}

async function decodeToken (token) {
  const { V3 } = paseto
  const payload = await V3.decrypt(
    token,
    Buffer.from(
      '4171a1687aa54ae83439a62f873a12917ff4eaa89c8b51cc2d09830b7f4e528b',
      'hex'
    )
  )
  return payload
}

app.listen(port, () => {
  console.log(`[Server] running at http://localhost:${port}\n\n`)
})
