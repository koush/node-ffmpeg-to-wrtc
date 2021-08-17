import { Server } from 'ws';
import express from 'express';
import { FFMpegRTCSession } from '.';
const app = express();

app.use(express.static('example'))

const port = process.env.PORT || 3000;
const server = app.listen(process.env.PORT || 3000);
const websocketServer = new Server({ noServer: true });

websocketServer.on('connection', function connection(ws) {
    console.log('received websocket');
    const streamer = new FFMpegRTCSession('rtsp://192.168.2.1:7447/LBZ0X6tMkjuA9394',
      json => ws.send(JSON.stringify(json)));
    ws.onmessage = message => {
      streamer.onMessage(JSON.parse(message.data as string));
    }
});


server.on('upgrade', function upgrade(request, socket, head) {
  websocketServer.handleUpgrade(request, socket as any, head, function done(ws) {
    websocketServer.emit('connection', ws, request);
  });
});

console.log(`Server listening at http://localhost:${port}/`);
