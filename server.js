import redis from 'redis'
import express from 'express'
import { WebSocketServer } from 'ws'
import url from 'url'
import paseto from 'paseto'

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


const socket = new WebSocketServer({
  port: 5001,
  path: '/websockets'
})

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

socket.on("close", ()  => { /*WS not implemented, implement keep alive ... */ })

socket.on('connection',async (websocket, request) => {
  //const origin = request.headers.origin
  //const origin = 'https://interadoo88.intrix.si/'
  //const clientID = url.parse(origin, true).hostname.split('.')[0]

  const uuid = request.headers['sec-websocket-key']

  const query = url.parse(request.url, true).query

  //const { token } = query
  const token = "v3.local.VKlNogsHwZ-7tkGNTa4sWHBPmQH_AjcLqmyfODkOTQD96DoH4pQh1wceSPb_40YlWDy_4ekeAPh2rgQ7BVGoJkDa6I7Mwng--4s--D1zMMi7f-B1PVk49amlIXdfJEltZLoNWyvEgCoRgcKfu_FQC4jkr-ln2kM2UsmOBwME00Ie4Tf_0l2iabXdMjoyh_5qOnfrdH5wbKhcjZ9YnuW6RhY"
  
  const tkn = await decodeToken(token)
  const {client_id: clientID, user_id: username} = tkn

  if (!websocketClients[clientID]) {
    websocketClients[clientID] = {}
  }



  if (!websocketClients[clientID][username]) {
    websocketClients[clientID][username] = {}
  }

  websocketClients[clientID][username][uuid] = {
    websocket,
    route: '',
  }

  
  redisClient.pSubscribe(`in3x/${clientID}/user/*`, payload => {
    const websocket = websocketClients[clientID][username][uuid].websocket
    websocket?.send(payload)
  })
  
  const sockets = websocketClients[clientID][username]

  websocket.on('message', async (_payload) => {

    const payload = JSON.parse(_payload)

    //console.log('[payload]: ' + JSON.stringify(payload, null, 4))
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
          const websocket = websocketClients[clientID][username][uuid].websocket
          websocket?.send(payload)
        })

        console.log('[SUBSCRIBE]', uuid, path)
        
        console.log({sockets})


        const redisClient2 = redis.createClient(redisConfig)
        await redisClient2.connect()
        let PUBSUB_CHANNELS = await redisClient2.PUBSUB_CHANNELS()
        console.log({PUBSUB_CHANNELS})
        redisClient2.disconnect()


        break
      case 'disconnect':
        delete websocketClients[clientID][username][uuid]

        console.log({sockets})
        break

      default:
        break
    }
  })
})

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
