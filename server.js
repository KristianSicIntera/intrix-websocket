import redis from 'redis'
import paseto from 'paseto'
import { Server } from 'socket.io'

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
    payload = await V3.decrypt(
      token,
      Buffer.from(
        '4171a1687aa54ae83439a62f873a12917ff4eaa89c8b51cc2d09830b7f4e528b',
        'hex'
      )
    )
  } catch (error) {}

  return payload
}

const connect = async socket => {
  const { token } = socket
  const tkn = await decodeToken(token)
  if (!tkn) {
    return
  }
  const { client_id: clientID, user_id: username } = tkn

  socket.username = username

  console.log('[CONNECTED]', { tkn })

  redisClient.subscribe(`in3x/${clientID}/user/${username}`, payload => {
    socket.send(payload)
  })

  socket.on('disconnect', reason => disconnect(socket, reason))
  socket.on('message', payload => message(socket, payload, tkn))
}

const disconnect = (socket, reason) => {
  
  console.log('[DISCONECT]', { reason, socket })
}

const message = (socket, _payload, tkn) => {
  console.log('[MESSAGE]', { _payload })

  const { client_id: clientID } = tkn
  const payload = JSON.parse(_payload)
  const uuid = socket.id

  switch (payload.type) {
    case 'route-change':
      const { route } = payload
      const { path } = route
      const previousPath = socket.route

      if (previousPath) {
        const previousChannel = `in3x/${clientID}/watch${previousPath}`
        redisClient.unsubscribe(previousChannel)
        console.log('[UN][SUBSCRIBE]', uuid, previousPath)
      }

      const channel = `in3x/${clientID}/watch${path}`

      socket.route = path

      redisClient.subscribe(channel, payload => socket.send(payload))

      console.log('[SUBSCRIBE]', uuid, path)
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
                    route: socket.route
                  }
                })
              )
            ]
          })
        )
      })
      break
    case 'whoami':
      const { username, route: _route } = socket
      socket.send(
        JSON.stringify({
          type: 'whoami',
          data: {
            username,
            route: _route || {}
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
      socket.token = token
      next()
    } else {
      next(new Error('Authentication error'))
    }
  })
  .on('connection', connect)
