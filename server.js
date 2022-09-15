import redis from 'redis'
import paseto from 'paseto'
import * as dotenv from 'dotenv'
import { Server } from 'socket.io'

import { createServer } from 'http'
import { instrument } from '@socket.io/admin-ui'

dotenv.config()
console.clear()

const env = process.env.NODE_ENV || 'dev'

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

const redisClient = redis.createClient(redisConfig)

const httpServer = createServer()

const socketio = new Server(httpServer, {
  cors: {
    origin: ['https://admin.socket.io'],
    credentials: true
  }
})

instrument(socketio, {
  auth: false
})

const decodeToken = token => {
  const {V3} = paseto
  return V3.decrypt(token, Buffer.from(process.env.PASETO_KEY, 'hex'))
}

const connect = async socket => {
  const { client_id: clientID, user_id: username } = socket.data
  redisClient.subscribe(`in3x/${clientID}/user/${username}`, payload => socket.send(payload))
  socket.on('disconnect', reason => disconnect(socket, reason))
  socket.on('message', payload => message(socket, payload))
}

const disconnect = (socket, _reason) => {
  const { client_id: clientID, user_id: username } = socket.data
  redisClient.unsubscribe(`in3x/${clientID}/user/${username}`)
}

const message = async (socket, _payload) => {
  const { client_id: clientID, user_id: username } = socket.data
  const {watch} = socket
  const payload = JSON.parse(_payload)
  switch (payload.type) {
    case 'route-change':
      const {path} = payload.route
      const channel = `in3x/${clientID}/watch${path}`
      if (watch) { redisClient.unsubscribe(watch)}
      redisClient.subscribe(channel, payload => socket.send(payload))
      socket.watch = channel
      break
    case 'list-clients':
      const sockets = await socketio.fetchSockets()
      socket.send(
        JSON.stringify({
          type: 'list-clients',
          data: [
            ...new Set(
              sockets.map(socket => {
                return {
                  username,
                  watch,
                }
              })
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
            watch,
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

httpServer.listen(5001)
//socketio.listen(5001)

console.log('IO','🚀')

redisClient.on('error', err =>  console.error('[Error] ' + err))

redisClient.connect().then(()=>{
  console.log('REDIS','🚀')
})

socketio.of(/^\/\w+$/)
  .use(async (socket, next) => {
    const token = socket.handshake.auth.token
    if (token) {
      try {
        socket.data = await decodeToken(token)
        const workspace = socket.nsp.name.substring(1)
        const {client_id} = socket.data
        if (workspace == client_id) {
          next(null, true)
        } else {
          next(new Error('[authorization error][data missmatch]'))
        }
      } catch (error) {
        next(new Error('[Authentication error][invalid token]'))
      }
    } else {
      next(new Error('[error][no token provided]'))
    }
  })
  .on('connection', connect)
