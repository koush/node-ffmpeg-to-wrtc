import EventEmitter, { once } from "events";
import net from 'net';
import child_process from 'child_process';
import os from 'os';

const wrtc = require('wrtc');
Object.assign(global, wrtc);
const { RTCVideoSource, RTCAudioSource } = wrtc.nonstandard;


async function listenRandom(server: net.Server) {
    server.listen(0);
    await once(server, 'listening');
}


export interface AVSource {
    videoSource: any;
    audioSource: any;
    cp: child_process.ChildProcess;
};

export async function createAudioVideoSource(url: string): Promise<AVSource> {
    const videoSource = new RTCVideoSource();
    const audioSource = new RTCAudioSource();

    const videoServer = net.createServer(async (socket) => {
        videoServer.close()
        const res = await resolution;
        const width = parseInt(res[2]);
        const height = parseInt(res[3]);
        const toRead = parseInt(res[2]) * parseInt(res[3]) * 1.5;
        socket.on('readable', () => {
            while (true) {
                const buffer: Buffer = socket.read(toRead);
                if (!buffer)
                    return;
                const data = new Uint8ClampedArray(buffer);
                const frame = { width, height, data };
                try {
                    videoSource.onFrame(frame)
                }
                catch (e) {
                    cp.kill();
                    console.error(e);
                }
            }
        });
    });
    await listenRandom(videoServer);

    const audioServer = net.createServer(async (socket) => {
        audioServer.close()
        const { sample_rate, channels } = await sampleInfo;
        const bitsPerSample = 16;
        const channelCount = channels[1] === 'mono' ? 1 : 2;
        const sampleRate = parseInt(sample_rate[1]);

        const toRead = sampleRate / 100 * channelCount * 2;
        socket.on('readable', () => {
            while (true) {
                const buffer: Buffer = socket.read(toRead);
                if (!buffer)
                    return;

                const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + toRead)
                const samples = new Int16Array(ab);  // 10 ms of 16-bit mono audio

                const data = {
                    samples,
                    sampleRate,
                    bitsPerSample,
                    channelCount,
                };
                try {
                    audioSource.onData(data);
                }
                catch (e) {
                    cp.kill();
                    console.error(e);
                }
            }
        });
    });
    await listenRandom(audioServer);


    const videoPort = (videoServer.address() as net.AddressInfo).port;
    const audioPort = (audioServer.address() as net.AddressInfo).port;

    const inputArguments = [
        "-rtsp_transport",
        "tcp",
        "-i",
        url,
        '-analyzeduration', '15000000',
        '-probesize', '100000000',
        "-reorder_queue_size",
        "1024",
        "-max_delay",
        "20000000",
    ]

    const args = [];
    args.push('-y');
    args.push(...inputArguments);
    args.push('-vcodec', 'none');
    args.push('-acodec', 'pcm_s16le');
    args.push('-f', 's16le');
    args.push(`tcp://127.0.0.1:${audioPort}`);
    args.push('-vcodec', 'rawvideo');
    args.push('-acodec', 'none');
    args.push('-pix_fmt', 'yuv420p');
    args.push('-f', 'rawvideo');
    args.push(`tcp://127.0.0.1:${videoPort}`);

    let ffmpeg = 'ffmpeg';
    if (os.platform() === 'win32') {
        ffmpeg += '.exe';
    }
    const cp = child_process.spawn(ffmpeg, args, {
        // stdio: 'ignore',
    });
    cp.on('error', e => console.error('ffmpeg error', e));
    cp.stdout.on('data', data => console.log(data.toString()));
    cp.stderr.on('data', data => console.error(data.toString()));

    const resolution = new Promise<Array<string>>(resolve => {
        cp.stdout.on('data', data => {
            const stdout = data.toString();
            const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
            if (res)
                resolve(res);
        });
        cp.stderr.on('data', data => {
            const stdout = data.toString();
            const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
            if (res)
                resolve(res);
        });
    });

    interface SampleInfo {
        sample_rate: string[];
        channels: string[];
    }

    const sampleInfo = new Promise<SampleInfo>(resolve => {
        const parser = (data: Buffer) => {
            const stdout = data.toString();
            const sample_rate = /([0-9]+) Hz/i.exec(stdout)
            const channels = /Audio:.* (stereo|mono)/.exec(stdout)
            if (sample_rate && channels) {
                resolve({
                    sample_rate, channels,
                });
            }
        };
        cp.stdout.on('data', parser);
        cp.stderr.on('data', parser);
    });

    return {
        videoSource,
        audioSource,
        cp,
    }
}

export class FFMpegRTCSession {
    url: string;
    send: (json: any) => void;
    pc: RTCPeerConnection;
    events = new EventEmitter();
    avSource: AVSource;

    constructor(avSource: AVSource, send: (json: any) => void,) {
        this.send = send;

        this.avSource = avSource;
        this._start();
    }

    async _start() {
        this.pc = new RTCPeerConnection();

        this.pc.onicecandidate = evt => {
            console.log('sending candidate', evt.candidate);
            this.send(evt.candidate);
        };

        this.pc.addTrack(this.avSource.videoSource.createTrack());
        this.pc.addTrack(this.avSource.audioSource.createTrack());


        const checkConn = () => {
            if (this.pc.iceConnectionState === 'failed' || this.pc.connectionState === 'failed') {
//                this.avSource.cp.kill();
            }
        }

        this.pc.onconnectionstatechange = checkConn;
        this.pc.oniceconnectionstatechange = checkConn;

        const offer = await this.pc.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
        });
        await this.pc.setLocalDescription(offer);
        this.send(offer);
        const answer = await this.receiveOneMessage();
        await this.pc.setRemoteDescription(answer);

        while (true) {
            const candidate = await this.receiveOneMessage();
            if (candidate) {
                this.pc.addIceCandidate(candidate);
            }
        }
    }

    onMessage(json: any) {
        this.events.emit('message', json);
    }

    async receiveOneMessage() {
        const [message] = await once(this.events, 'message');
        return message;
    }

    destroy() {

    }
}
