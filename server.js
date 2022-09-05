import redis from 'redis'
import paseto from 'paseto'
import * as dotenv from 'dotenv'
import { Server } from 'socket.io'

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
const socketio = new Server()

const decodeToken = async token => {
  const { V3 } = paseto
  let payload
  try {
    payload = await V3.decrypt(token, Buffer.from(process.env.PASETO_KEY, 'hex'))
  } catch (error) {
    return
  }
  return payload
}

const connect = async socket => {
  const { client_id: clientID, user_id: username } = socket.info

  socket.username = username

  console.log('[CONNECTED]', socket.info)

  redisClient.subscribe(`in3x/${clientID}/user/${username}`, payload =>
    socket.send(payload)
  )

  socket.on('disconnect', reason => disconnect(socket, reason))
  socket.on('message', payload => message(socket, payload))
}

const disconnect = (socket, reason) => {
  const { client_id: clientID, user_id: username } = socket.info
  redisClient.unsubscribe(`in3x/${clientID}/user/${username}`)
  console.log('[DISCONECT]', { reason, clientID, username })
}

const message = (socket, _payload) => {
  console.log('[MESSAGE]', { _payload })

  const { client_id: clientID, user_id: username } = socket.info

  const payload = JSON.parse(_payload)

  switch (payload.type) {
    case 'route-change':
      const { route } = payload
      const { path } = route
      const previousWatch = socket.watch

      if (previousWatch) {
        redisClient.unsubscribe(previousWatch)
        console.log('[UNSUBSCRIBE]', username, previousWatch)
      }

      const channel = `in3x/${clientID}/watch${path}`
      socket.watch = channel

      redisClient.subscribe(channel, payload => socket.send(payload))

      console.log('[SUBSCRIBE]', username, channel)
      break
    case 'list-clients':
      socketio.fetchSockets().then(sockets => {
        socket.send(
          JSON.stringify({
            type: 'list-clients',
            data: [
              ...new Set(
                sockets.map(socket => {
                  return {
                    username: socket.username,
                    watch: socket.watch
                  }
                })
              )
            ]
          })
        )
      })
      break
    case 'whoami':
      const { username: _username, watch } = socket
      socket.send(
        JSON.stringify({
          type: 'whoami',
          data: {
            username: _username,
            watch: watch || {}
          }
        })
      )
      break
    case 'redis':
      checkClients().then(channels => {
        socket.send(
          JSON.stringify({
            type: 'redis',
            data: channels
          })
        )
      })
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

console.log('redisConfig: ' + JSON.stringify(redisConfig, null, 4))

socketio.listen(5001)

redisClient.on('error', err => {
  console.log('[Error] ' + err)
})

redisClient.connect().then(async () => {
  console.log('[successfully connected to redis]')
})

socketio
  .use((socket, next) => {
    const token = socket.handshake.auth.token
    if (token) {
      decodeToken(token).then(info => {
        if (info) {
          socket.info = info
          next()
        } else {
          next(new Error('[Authentication error][invalid token]'))
        }
      })
    } else {
      next(new Error('[Authentication error][no token provided]'))
    }
  })
  .on('connection', connect)
