import redis from 'redis'
import paseto from 'paseto'
import * as dotenv from 'dotenv'
import { Server } from 'socket.io'

//import { createServer } from 'http'
//import { instrument } from '@socket.io/admin-ui'

dotenv.config()
console.clear()

const env = process.env.NODE_ENV || 'dev'

const redisConfig =
  env == 'production'
    ? {
        socket: {
          host: 'redis',
          port: 6379
        },
        password: 'mypassword'
      }
    : {}

console.log({ redisConfig })

const redisClient = redis.createClient(redisConfig)

//const httpServer = createServer()

// const socketio = new Server(httpServer, {
//   cors: {
//     origin: ['https://admin.socket.io'],
//     credentials: true
//   }
// })

const socketio = new Server()

//instrument(socketio, {
//  auth: false
//})

const decodeToken = token => {
  const { V3 } = paseto
  const key = Buffer.from(process.env.PASETO_KEY, 'hex')
  return V3.decrypt(token, key)
}

const connect = async socket => {
  const { client_id: clientID, user_id: username } = socket.data
  const indentiffier = `in3x/${clientID}/user/${username}`
  socket.on('disconnect', reason => disconnect(socket, reason))
  socket.on('message', payload => message(socket, payload))
  redisClient.subscribe(indentiffier, payload => socket.send(payload))
  socket.join(indentiffier)
}

const disconnect = (socket, _reason) => {
  const { client_id: clientID, user_id: username } = socket.data
  redisClient.unsubscribe(`in3x/${clientID}/user/${username}`)
}

const message = async (socket, _payload) => {
  const { client_id: clientID, user_id: username } = socket.data
  const { watch } = socket
  const payload = JSON.parse(_payload)
  switch (payload.type) {
    case 'route-change':
      const { path } = payload.route
      const indentiffier = `in3x/${clientID}/watch${path}`
      if (watch) {
        redisClient.unsubscribe(watch)
        socket.leave(watch)
      }
      redisClient.subscribe(indentiffier, payload => socket.send(payload))
      socket.join(indentiffier)
      socket.watch = indentiffier
      break
    case 'list-clients':
      const sockets = await socketio.fetchSockets()
      socket.send(
        JSON.stringify({
          type: 'list-clients',
          data: [
            ...new Set(
              sockets.map(socket => socket.data)
            )
          ]
        })
      )
      break
    case 'whoami':
      socket.send(
        JSON.stringify({
          type: 'whoami',
          data: {
            username,
            watch
          }
        })
      )
      break
    case 'redis':
      const channels = await checkClients()
      socket.send(
        JSON.stringify({
          type: 'redis',
          data: channels
        })
      )
      break
  }
}

async function checkClients () {
  const redisClient2 = redis.createClient(redisConfig)
  await redisClient2.connect()
  let PUBSUB_CHANNELS = await redisClient2.PUBSUB_CHANNELS()
  redisClient2.disconnect()
  return PUBSUB_CHANNELS
}

//httpServer.listen(5001)
socketio.listen(5001)

console.log('IO', '🚀')

redisClient.on('error', err => console.error('[Error] ' + err))

redisClient.connect().then(() => {
  console.log('REDIS', '🚀')
})

socketio
  .use(async (socket, next) => {
    const {host, origin} = socket.handshake.headers
    const token = socket.handshake.auth.token
    if (token) {
      try {
        socket.data = await decodeToken(token)
        console.log({host, origin})
        next(null, true)
      } catch (error) {
        next(new Error('[Authentication error][invalid token]'))
      }
    } else {
      next(new Error('[error][no token provided]'))
    }
  })
  .on('connection', connect)
