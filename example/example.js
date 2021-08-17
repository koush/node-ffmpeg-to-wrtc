async function receiveWebsocketMessage(ws) {
    return new Promise(resolve => ws.onmessage = message => resolve(JSON.parse(message.data)));
}

function sendWebsocketMessage(ws, data) {
    ws.send(JSON.stringify(data));
}

async function connect() {
    const video = document.getElementById('media');

    console.log('connecting websocket');
    const ws = new WebSocket(`ws://${window.location.host}`);

    const pc = new RTCPeerConnection();

    pc.onicecandidate = evt => {
        console.log('sending candidate', evt.candidate);
        sendWebsocketMessage(ws, evt.candidate);
    };

    const checkConn = () => {
        console.log('connecton state', pc.connectionState);
        pc.onconnectionstatechange = () => console.log(pc.connectionState);
        if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
            console.error('connection failed');
        }
    }

    pc.onconnectionstatechange = checkConn;
    pc.onsignalingstatechange = checkConn;
    pc.ontrack = () => {
        const mediaStream = new MediaStream(
            pc.getReceivers().map((receiver) => receiver.track)
        );
        video.srcObject = mediaStream;
        const remoteAudio = document.createElement("audio");
        remoteAudio.srcObject = mediaStream;
        remoteAudio.play();
    };

    console.log('waiting for websocket offer');
    const offer = await receiveWebsocketMessage(ws);
    console.log('got offer', offer);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    console.log('created answer', answer);
    await pc.setLocalDescription(answer);
    sendWebsocketMessage(ws, answer);

    while (true) {
        const candidate = await receiveWebsocketMessage(ws);
        if (candidate) {
            pc.addIceCandidate(candidate);
        }
    }
}