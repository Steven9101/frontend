import { createDecoder, firdes_kaiser_lowpass } from './lib/wrappers'

import createWindow from 'live-moving-average'
import { decode as cbor_decode } from 'cbor-x';
import { encode, decode } from "./modules/ft8.js";

import { AudioContext, ConvolverNode, IIRFilterNode, GainNode, AudioBuffer, AudioBufferSourceNode, DynamicsCompressorNode } from 'standardized-audio-context'
import { BiquadFilterNode } from 'standardized-audio-context';
export default class SpectrumAudio {
  constructor(endpoint) {

    
    this.endpoint = endpoint

    this.playAmount = 0

    this.playMovingAverage = []
    this.playSampleLength = 1
    this.audioQueue = []

    this.demodulation = 'USB'

    // Decoders
    this.accumulator = [];
    this.decodeFT8 = false;
    this.farthestDistance = 0;
    this.nb = false;

    // Audio controls
    this.mute = false
    this.squelchMute = false
    this.squelch = false
    this.squelchThreshold = 0
    this.power = 1
    this.ctcss = false
     // Remove the element with id startaudio from the DOM
      

    if (this.audioCtx && this.audioCtx.state == 'running') {
      startaudio = document.getElementById('startaudio')
      if (startaudio) {
        startaudio.remove()
      }
    }else
    {
      // for chrome
      const userGestureFunc = () => {
        if (this.audioCtx && this.audioCtx.state !== 'running') {
          this.audioCtx.resume()
        }
        // Remove the element with id startaudio from the DOM
        const startaudio = document.getElementById('startaudio')
        if (startaudio) {
          startaudio.remove()
        }
        document.documentElement.removeEventListener('mousedown', userGestureFunc)
      }
      document.documentElement.addEventListener('mousedown', userGestureFunc)
    }
    

    this.mode = 0
    this.d = 10
    this.v = 10
    this.n2 = 10
    this.n1 = 10
    this.var = 10
    this.highThres = 1

    this.initTimer(); // Start the timing mechanism
  }

  async init() {
    if (this.promise) {
      return this.promise
    }

    this.promise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })

    this.audioSocket = new WebSocket(this.endpoint)
    this.audioSocket.binaryType = 'arraybuffer'
    this.firstAudioMessage = true
    this.audioSocket.onmessage = this.socketMessageInitial.bind(this)

    return this.promise
  }

  stop() {
    this.audioSocket.close()
    this.decoder.free()
  }

  initAudio(settings) {
    const sampleRate = this.audioOutputSps
    try {
      this.audioCtx = new AudioContext({
        sampleRate: sampleRate
      })
    } catch {
      this.resolvePromise()
      return
    }
  
    this.audioStartTime = this.audioCtx.currentTime
    this.playTime = this.audioCtx.currentTime + 0.1
    this.playStartTime = this.audioCtx.currentTime
  
    this.decoder = createDecoder(settings.audio_compression, this.audioMaxSps, this.trueAudioSps, this.audioOutputSps)
    
    // Bass boost (lowshelf filter)
    this.bassBoost = new BiquadFilterNode(this.audioCtx)
    this.bassBoost.type = 'lowshelf'
    this.bassBoost.frequency.value = 150
    this.bassBoost.Q.value = 0.7
    this.bassBoost.gain.value = 6
  
    // Bandpass filter for speech enhancement
    this.bandpass = new BiquadFilterNode(this.audioCtx)
    this.bandpass.type = 'peaking'
    this.bandpass.frequency.value = 1800
    this.bandpass.Q.value = 1.2
    this.bandpass.gain.value = 3
  
    // High-pass filter
    this.highPass = new BiquadFilterNode(this.audioCtx)
    this.highPass.type = 'highpass'
    this.highPass.frequency.value = 60
    this.highPass.Q.value = 0.7
    
    // Presence boost
    this.presenceBoost = new BiquadFilterNode(this.audioCtx)
    this.presenceBoost.type = 'peaking'
    this.presenceBoost.frequency.value = 3500
    this.presenceBoost.Q.value = 1.5
    this.presenceBoost.gain.value = 4
    
    // Convolver node for additional filtering
    this.convolverNode = new ConvolverNode(this.audioCtx)
    this.setLowpass(15000)
  
    // Dynamic compressor
    this.compressor = new DynamicsCompressorNode(this.audioCtx)
    this.compressor.threshold.value = -24
    this.compressor.knee.value = 30
    this.compressor.ratio.value = 12
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.25
  
    // Gain node
    this.gainNode = new GainNode(this.audioCtx)
    this.setGain(5)
  

  
    // Connect nodes in the correct order
    this.convolverNode.connect(this.highPass)
    this.highPass.connect(this.bandpass)
    this.bandpass.connect(this.bassBoost)
    this.bassBoost.connect(this.presenceBoost)
    this.presenceBoost.connect(this.compressor)
    this.compressor.connect(this.gainNode)
    this.gainNode.connect(this.audioCtx.destination)
  
    this.audioInputNode = this.convolverNode
  
    // Initial filter update based on current demodulation
    this.updateFilters()
  
    this.resolvePromise(settings)
  }
  
  updateFilters() {
    switch (this.demodulation) {
      case 'USB':
      case 'LSB':
        this.bassBoost.gain.value = 12
        this.bandpass.frequency.value = 1800
        this.bandpass.Q.value = 1.2
        this.bandpass.gain.value = 3
        this.highPass.frequency.value = 60
        this.presenceBoost.gain.value = 4
        this.setLowpass(3000)
        break
      case 'CW-U':
      case 'CW-L':
        this.bassBoost.gain.value = 0
        this.bandpass.frequency.value = 700
        this.bandpass.Q.value = 4
        this.bandpass.gain.value = 6
        this.highPass.frequency.value = 400
        this.presenceBoost.gain.value = 2
        this.setLowpass(1000)
        break
      case 'AM':
        this.bassBoost.gain.value = 20
        this.bandpass.frequency.value = 1500
        this.bandpass.Q.value = 1
        this.bandpass.gain.value = 2
        this.highPass.frequency.value = 50
        this.presenceBoost.gain.value = 3
        this.setLowpass(4500)
        break
      case 'FM':
        this.bassBoost.gain.value = 30
        this.bandpass.frequency.value = 1500
        this.bandpass.Q.value = 0.8
        this.bandpass.gain.value = 2
        this.highPass.frequency.value = this.ctcss ? 300 : 30
        this.presenceBoost.gain.value = 3
        this.setLowpass(15000)
        break
    }
  }


  setFIRFilter(fir) {
    const firAudioBuffer = new AudioBuffer({ length: fir.length, numberOfChannels: 1, sampleRate: this.audioOutputSps })
    firAudioBuffer.copyToChannel(fir, 0, 0)
    this.convolverNode.buffer = firAudioBuffer
  }

  setLowpass(lowpass) {
    const sampleRate = this.audioOutputSps
    // Bypass the FIR filter if the sample rate is low enough
    if (lowpass >= sampleRate / 2) {
      this.setFIRFilter(Float32Array.of(1))
      return
    }
    const fir = firdes_kaiser_lowpass(lowpass / sampleRate, 1000 / sampleRate, 0.001)
    this.setFIRFilter(fir)
  }

  setFT8Decoding(value)
  {
    this.decodeFT8 = value;
  }

  setFmDeemph(tau) {
    if (tau === 0) {
      this.audioInputNode = this.convolverNode
      return
    }
    // FM deemph https://github.com/gnuradio/gnuradio/blob/master/gr-analog/python/analog/fm_emph.py
    // Digital corner frequency
    const wc = 1.0 / tau
    const fs = this.audioOutputSps

    // Prewarped analog corner frequency
    const wca = 2.0 * fs * Math.tan(wc / (2.0 * fs))

    // Resulting digital pole, zero, and gain term from the bilinear
    // transformation of H(s) = w_ca / (s + w_ca) to
    // H(z) = b0 (1 - z1 z^-1)/(1 - p1 z^-1)
    const k = -wca / (2.0 * fs)
    const z1 = -1.0
    const p1 = (1.0 + k) / (1.0 - k)
    const b0 = -k / (1.0 - k)

    const feedForwardTaps = [b0 * 1.0, b0 * -z1]
    const feedBackwardTaps = [1.0, -p1]

    this.fmDeemphNode = new IIRFilterNode(this.audioCtx, { feedforward: feedForwardTaps, feedback: feedBackwardTaps })
    this.fmDeemphNode.connect(this.convolverNode)

    this.audioInputNode = this.fmDeemphNode
  }

  socketMessageInitial(event) {
    // first message gives the parameters in json
    const settings = JSON.parse(event.data)
    this.settings = settings
    this.fftSize = settings.fft_size
    this.audioMaxSize = settings.fft_result_size
    this.baseFreq = settings.basefreq
    this.totalBandwidth = settings.total_bandwidth
    this.sps = settings.sps
    this.audioOverlap = settings.fft_overlap / 2
    this.audioMaxSps = settings.audio_max_sps
    this.grid_locator = settings.grid_locator
    this.smeter_offset = settings.smeter_offset

    this.audioL = settings.defaults.l
    this.audioM = settings.defaults.m
    this.audioR = settings.defaults.r

    const targetFFTBins = Math.ceil(this.audioMaxSps * this.audioMaxSize / this.sps / 4) * 4

    this.trueAudioSps = targetFFTBins / this.audioMaxSize * this.sps
    this.audioOutputSps = Math.min(this.audioMaxSps, 96000)

    this.audioSocket.onmessage = this.socketMessage.bind(this)

    this.initAudio(settings)

    console.log('Audio Samplerate: ', this.trueAudioSps)
  }

  socketMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      const packet = cbor_decode(new Uint8Array(event.data))
      const receivedPower = packet.pwr
      this.power = 0.5 * this.power + 0.5 * receivedPower || 1
      const dBpower = 20 * Math.log10(Math.sqrt(this.power) / 2)
      this.dBPower = dBpower
      if (this.squelch && dBpower < this.squelchThreshold) {
        this.squelchMute = true
      } else {
        this.squelchMute = false
      }

      this.decode(packet.data)
    }
  }

  decode(encoded) {
    // Audio not available
    if (!this.audioCtx) {
      return
    }
    let pcmArray = this.decoder.decode(encoded)
    // More samples needed
    if (pcmArray.length === 0) {
      return
    }

    this.intervals = this.intervals || createWindow(10000, 0)
    this.lens = this.lens || createWindow(10000, 0)
    this.lastReceived = this.lastReceived || 0
    // For checking sample rate
    if (this.lastReceived === 0) {
      this.lastReceived = performance.now()
    } else {
      const curReceived = performance.now()
      const delay = curReceived - this.lastReceived
      this.intervals.push(delay)
      this.lastReceived = curReceived
      this.lens.push(pcmArray.length)

      let updatedv = true

      if (this.mode === 0) {
        if (Math.abs(delay - this.n1) > Math.abs(this.v) * 2 + 800) {
          this.var = 0
          this.mode = 1
        }
      } else {
        this.var = this.var / 2 + Math.abs((2 * delay - this.n1 - this.n2) / 8)
        if (this.var <= 63) {
          this.mode = 0
          updatedv = false
        }
      }

      if (updatedv) {
        if (this.mode === 0) {
          this.d = 0.125 * delay + 0.875 * this.d
        } else {
          this.d = this.d + delay - this.n1
        }
        this.v = 0.125 * Math.abs(delay - this.d) + 0.875 * this.v
      }

      this.n2 = this.n1
      this.n1 = delay
    }

    this.pcmArray = pcmArray
    if (this.signalDecoder) {
      this.signalDecoder.decode(pcmArray)
    }

    this.playAudio(pcmArray)
  }

  updateAudioParams() {
    this.audioSocket.send(JSON.stringify({
      cmd: 'window',
      l: this.audioL,
      m: this.audioM,
      r: this.audioR
    }))
  }

  setAudioDemodulation(demodulation) {

    this.demodulation = demodulation
    this.updateFilters()
    this.audioSocket.send(JSON.stringify({
      cmd: 'demodulation',
      demodulation: demodulation
    }))
  }

  setAudioRange(audioL, audioM, audioR) {
    this.audioL = Math.floor(audioL)
    this.audioM = audioM
    this.audioR = Math.ceil(audioR)
    this.actualL = audioL
    this.actualR = audioR
    this.updateAudioParams()
  }

  getAudioRange() {
    return [this.actualL, this.audioM, this.actualR]
  }

  setAudioOptions(options) {
    this.audioOptions = options
    this.audioSocket.send(JSON.stringify({
      cmd: 'options',
      options: options
    }))
  }

  setGain(gain) {
    gain /= 35; 
    this.gain = gain 
    this.gainNode.gain.value = gain 
  }

  setMute(mute) {
    if (mute === this.mute) {
      return
    }
    this.mute = mute
    this.audioSocket.send(JSON.stringify({
      cmd: 'mute',
      mute: mute
    }))
  }

  setCTCSSFilter(ctcss)
  {
    this.ctcss = ctcss;
    this.updateFilters();
  }

  setSquelch(squelch) {
    this.squelch = squelch
  }

  setSquelchThreshold(squelchThreshold) {
    this.squelchThreshold = squelchThreshold
  }

  getPowerDb() {
    return this.dBPower
  }

  setUserID(userID) {
    this.audioSocket.send(JSON.stringify({
      cmd: 'userid',
      userid: userID
    }))
  }

  setSignalDecoder(decoder) {
    this.signalDecoder = decoder
  }

  getSignalDecoder() {
    return this.signalDecoder
  }


  // FT8 Start


  gridSquareToLatLong(gridSquare) {
      const l = gridSquare.toUpperCase();
      let lon = ((l.charCodeAt(0) - 'A'.charCodeAt(0)) * 20) - 180;
      let lat = ((l.charCodeAt(1) - 'A'.charCodeAt(0)) * 10) - 90;

      if (l.length >= 4) {
          lon += ((l.charCodeAt(2) - '0'.charCodeAt(0)) * 2);
          lat += (l.charCodeAt(3) - '0'.charCodeAt(0));
      }
      
      if (l.length == 6) {
          lon += ((l.charCodeAt(4) - 'A'.charCodeAt(0)) * (5 / 60));
          lat += ((l.charCodeAt(5) - 'A'.charCodeAt(0)) * (2.5 / 60));
          lon += (5 / 120); // center of the square for 6-char grid
          lat += (1.25 / 120); // center of the square for 6-char grid
      } else if (l.length == 4) {
          lon += 1; // center of the square for 4-char grid
          lat += 0.5; // center of the square for 4-char grid
      }

      return [lat, lon];
  }


  initTimer() {
    // Check every second to adjust the collecting status based on current time
    setInterval(() => {
      this.updateCollectionStatus();
    }, 1000);
  }

  // For FT8
  extractGridLocators(message) {
    // Regular expression for matching grid locators
    const regex = /[A-R]{2}[0-9]{2}([A-X]{2})?/gi;
    
    // Find matches in the provided message
    const matches = message.match(regex);
    
    // Ensure unique matches, as the same locator might appear more than once
    const uniqueLocators = matches ? Array.from(new Set(matches)) : [];
    
    return uniqueLocators;
  }


  calculateDistance(lat1, lon1, lat2, lon2) {
    function toRad(x) {
      return x * Math.PI / 180;
    }
  
    var R = 6371; // km
    var dLat = toRad(lat2-lat1);
    var dLon = toRad(lon2-lon1);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var d = R * c;
    return d;
  }
  
  


  updateCollectionStatus() {
    const now = new Date();
    const seconds = now.getSeconds();
    const waitSeconds = 15 - (seconds % 15);
    
    if (waitSeconds === 15 && !this.isCollecting) {
      this.startCollection();
    } else if (waitSeconds === 1 && this.isCollecting) {
      this.stopCollection();
    }
  }

  startCollection() {
    this.isCollecting = true;
    this.accumulator = []; // Reset the accumulator
  }

  async stopCollection() {
    this.isCollecting = false;
    if(this.decodeFT8) {
      const bigFloat32Array = new Float32Array(this.accumulator.flat());
      let decodedMessages = await decode(bigFloat32Array);
      const messagesListDiv = document.getElementById('ft8MessagesList');
  
      let baseLocation = this.gridSquareToLatLong(this.grid_locator);
  
      for (let message of decodedMessages) {
        let locators = this.extractGridLocators(message.text);
  
        if(locators.length > 0) {
          let targetLocation = this.gridSquareToLatLong(locators[0]);
          let distance = this.calculateDistance(baseLocation[0], baseLocation[1], targetLocation[0], targetLocation[1]);
  
          if (distance > this.farthestDistance) {
            this.farthestDistance = distance;
            document.getElementById('farthest-distance').textContent = `Farthest Distance: ${this.farthestDistance.toFixed(2)} km`;
          }
  
          const messageDiv = document.createElement('div');
          messageDiv.classList.add('glass-message', 'p-2', 'rounded-lg', 'text-sm', 'flex', 'justify-between', 'items-center');
  
          // Message content
          const messageContent = document.createElement('div');
          messageContent.classList.add('flex-grow');
          messageContent.textContent = message.text;
          messageDiv.appendChild(messageContent);
  
          // Locators and distance
          const infoDiv = document.createElement('div');
          infoDiv.classList.add('flex', 'flex-col', 'items-end', 'ml-2', 'text-xs');
  
          // Locators
          const locatorsDiv = document.createElement('div');
          locators.forEach((locator, index) => {
            const locatorLink = document.createElement('a');
            locatorLink.href = `https://www.levinecentral.com/ham/grid_square.php?&Grid=${locator}&Zoom=13&sm=y`;
            locatorLink.classList.add('text-yellow-300', 'hover:underline');
            locatorLink.textContent = locator;
            locatorLink.target = "_blank";
            if (index > 0) locatorsDiv.appendChild(document.createTextNode(', '));
            locatorsDiv.appendChild(locatorLink);
          });
          infoDiv.appendChild(locatorsDiv);
  
          // Distance
          const distanceDiv = document.createElement('div');
          distanceDiv.textContent = `${distance.toFixed(2)} km`;
          infoDiv.appendChild(distanceDiv);
  
          messageDiv.appendChild(infoDiv);
  
          messagesListDiv.appendChild(messageDiv);
        }
      }
  
      setTimeout(() => {
        messagesListDiv.scrollTop = messagesListDiv.scrollHeight;
      }, 500);
    }
  }

  // FT8 END


  playAudio(pcmArray) {
    if (this.mute || (this.squelchMute && this.squelch)) {
      return
    }
    if (this.audioCtx.state !== 'running') {
      return
    }
  
    if (this.isCollecting && this.decodeFT8) {
      this.accumulator.push(...pcmArray);
    }
  
    const curPlayTime = this.playPCM(pcmArray, this.playTime, this.audioOutputSps, 1)
  
    // Dynamic adjustment of play time
    const currentTime = this.audioCtx.currentTime;
    const bufferThreshold = 0.1; // 100ms buffer
  
    if (this.playTime - currentTime <= bufferThreshold) {
      // Underrun: increase buffer
      this.playTime = currentTime + bufferThreshold + curPlayTime;
    } else if (this.playTime - currentTime > 0.5) {
      // Overrun: decrease buffer
      this.playTime = currentTime + bufferThreshold;
    } else {
      // Normal operation: advance play time
      this.playTime += curPlayTime;
    }
  }
  
  playPCM(buffer, playTime, sampleRate, scale) {
    if (!this.audioInputNode) {
      console.warn('Audio not initialized');
      return 0;
    }
  
    const source = new AudioBufferSourceNode(this.audioCtx);
    const audioBuffer = new AudioBuffer({ 
      length: buffer.length, 
      numberOfChannels: 1, 
      sampleRate: this.audioOutputSps 
    });
  
    audioBuffer.copyToChannel(buffer, 0, 0);
  
    source.buffer = audioBuffer;
    source.connect(this.audioInputNode);
  
    const scheduledTime = Math.max(playTime, this.audioCtx.currentTime);
    source.start(scheduledTime);
  
    source.onended = () => {
      source.disconnect();
    };
  
    return audioBuffer.duration;
  }
  
}