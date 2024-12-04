<script>

  const VERSION = "1.5.4 | Modified by Bas Heijermans - ON5HB";

  import { onDestroy, onMount, tick } from "svelte";
  import { fade, fly, scale } from "svelte/transition";
  import copy from "copy-to-clipboard";
  import { RollingMax } from "efficient-rolling-stats";
  import { writable } from "svelte/store";

  import PassbandTuner from "./lib/PassbandTuner.svelte";
  import FrequencyInput from "./lib/FrequencyInput.svelte";
  import FrequencyMarkers from "./lib/FrequencyMarkers.svelte";

  import { eventBus } from './eventBus';

  import { quintOut } from 'svelte/easing';

  import { pinch, pan } from "./lib/hammeractions.js";
  import { availableColormaps } from "./lib/colormaps";
  import {
    init,
    audio,
    waterfall,
    events,
    FFTOffsetToFrequency,
    frequencyToFFTOffset,
    frequencyToWaterfallOffset,
    getMaximumBandwidth,
    waterfallOffsetToFrequency,
  } from "./lib/backend.js";
  import {
    constructLink,
    parseLink,
    storeInLocalStorage,
  } from "./lib/storage.js";



  let isRecording = false;
  let canDownload = false;

  let waterfallCanvas;
  let spectrumCanvas;
  let graduationCanvas;
  let bandPlanCanvas;
  let tempCanvas;

  let frequencyInputComponent;

  let frequency;

  let passbandTunerComponent;

  let link;
  var chatContentDiv;

  function toggleRecording() {
    if (!isRecording) {
      audio.startRecording();
      isRecording = true;
      canDownload = false;
    } else {
      audio.stopRecording();
      isRecording = false;
      canDownload = true;
    }
  }

  function downloadRecording() {
    audio.downloadRecording();
  }


  function generateUniqueId() {
    return (
      Math.random().toString(36).substr(2, 10) +
      Math.random().toString(36).substr(2, 10)
    );
  }

  let userId; // Global variable to store the user's unique ID
  let autoAdjust = false;

  // Updates the passband display
  function updatePassband(passband) {
    passband = passband || audio.getAudioRange();
    const frequencies = passband.map(FFTOffsetToFrequency);
    // Bandwidth display also needs updating
    bandwidth = ((frequencies[2] - frequencies[0]) / 1000).toFixed(2);
    // Passband Display
    const offsets = frequencies.map(frequencyToWaterfallOffset);
    passbandTunerComponent.changePassband(offsets);
  }
  // Wheel zooming, update passband and markers
  function handleWaterfallWheel(e) {
    waterfall.canvasWheel(e);
    passbandTunerComponent.updatePassbandLimits();
    updatePassband();
    frequencyMarkerComponent.updateFrequencyMarkerPositions();
    
  }

  function handleBandPlanClick(event) {
    const rect = event.target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    
    // First, check if a marker was clicked
    const markerClicked = waterfall.handleMarkerClick(x);
    
    // If no marker was clicked, handle the passband click
    if (!markerClicked) {
      passbandTunerComponent.handlePassbandClick(event);
    }
  }

  function handleBandPlanMouseMove(event) {
    const rect = event.target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    if (waterfall.handleMarkerHover(x, y)) {
      event.target.style.cursor = 'pointer';
    } else {
      event.target.style.cursor = 'default';
      waterfall.updateBandPlan(); // Clear previous hover effects
    }
  }
  

  // Decoder
  let ft8Enabled = false;

  // Handling dragging the waterfall left or right
  let waterfallDragging = false;
  let waterfallDragTotal = 0;
  let waterfallBeginX = 0;
  function handleWaterfallMouseDown(e) {
    waterfallDragTotal = 0;
    waterfallDragging = true;
    waterfallBeginX = e.clientX;
  }
  function handleWindowMouseMove(e) {
    if (waterfallDragging) {
      waterfallDragTotal += Math.abs(e.movementX) + Math.abs(e.movementY);
      waterfall.mouseMove(e);
      updatePassband();
      frequencyMarkerComponent.updateFrequencyMarkerPositions();
    }
  }
  function handleWindowMouseUp(e) {
    if (waterfallDragging) {
      // If mouseup without moving, handle as click
      if (waterfallDragTotal < 2) {
        passbandTunerComponent.handlePassbandClick(e);
      }
      waterfallDragging = false;
    }
  }

  // Sidebar controls for waterfall and spectrum analyzer
  let waterfallDisplay = true;
  let spectrumDisplay = true;
  let biggerWaterfall = false;
  function handleSpectrumChange() {
    spectrumDisplay = !spectrumDisplay;
    waterfall.setSpectrum(spectrumDisplay);
  }

  function handleWaterfallSizeChange() {
    biggerWaterfall = !biggerWaterfall;
    waterfall.setWaterfallBig(biggerWaterfall);
  }


  let bandwidth;

  // Waterfall drawing
  let currentColormap = "gqrx";
  let alpha = 0.5;
  let brightness = 130;
  let min_waterfall = -30;
  let max_waterfall = 110;
  function initializeColormap() {
    // Check if a colormap is saved in local storage
    const savedColormap = localStorage.getItem('selectedColormap');
    if (savedColormap) {
      currentColormap = savedColormap;
    }
    waterfall.setColormap(currentColormap);
  }

  function handleWaterfallColormapSelect(event) {
    currentColormap = event.target.value;
    waterfall.setColormap(currentColormap);
    
    // Save the selected colormap to local storage
    localStorage.setItem('selectedColormap', currentColormap);


  }

  // Waterfall slider controls
  function handleAlphaMove() {
    waterfall.setAlpha(1 - alpha);
  }
  function handleBrightnessMove() {
    waterfall.setOffset(brightness);
  }
  function handleMinMove() {
    waterfall.setMinOffset(min_waterfall);
  }
  function handleMaxMove() {
    waterfall.setMaxOffset(max_waterfall);
  }

  function handleAutoAdjust(value) {
    autoAdjust = value;
    waterfall.autoAdjust = autoAdjust;
  }

  // Audio demodulation selection
  let demodulators = ["USB", "LSB", "CW", "CW-L", "AM", "FM"];
  const demodulationDefaults = {
    USB: { type: "USB", offsets: [-100, 2800] },
    LSB: { type: "LSB", offsets: [2800, -100] },
    "CW": { type: "USB", offsets: [250, 250] },
    //CW: { type: "CW", offsets: [2800, -100] },
    AM: { type: "AM", offsets: [4900, 4900] },
    FM: { type: "FM", offsets: [5000, 5000] },
    WBFM: { type: "FM", offsets: [95000, 95000] },
  };
  let demodulation = "USB";
  function roundAudioOffsets(offsets) {
    const [l, m, r] = offsets;
    return [Math.floor(l), m, Math.floor(r)];
  }
  function SetMode(mode) {
    if(mode == "CW-U" || mode == "CW-L")
      {
        mode = "CW"
      }
    console.log("Setting mode to", mode);
    demodulation = mode;

    handleDemodulationChange(null, true);
    updateLink();
  }

  // Demodulation controls
  function handleDemodulationChange(e, changed) {
    
    passbandTunerComponent.setMode(demodulation);
    const demodulationDefault = demodulationDefaults[demodulation];
    if (changed) {
      if (demodulation === "WBFM") {
        audio.setFmDeemph(50e-6);
      } else {
        audio.setFmDeemph(0);
      }
      if(demodulationDefault.type == "USB" && demodulationDefault.offsets[0] == 250)
      {
        audio.setAudioDemodulation("CW");
      }else
      {
        audio.setAudioDemodulation(demodulationDefault.type);
      }
      
    }
    let prevBFO = frequencyInputComponent.getBFO();
    let newBFO = demodulationDefault.bfo || 0;
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);
    m = m + newBFO - prevBFO;
    l = m - demodulationDefault.offsets[0];
    r = m + demodulationDefault.offsets[1];

    frequencyInputComponent.setBFO(newBFO);
    frequencyInputComponent.setFrequency();

    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);

    // CW
    const lOffset = l - 200;
    const mOffset = m - 750;
    const rOffset = r - 200;
    const audioParametersOffset = [lOffset, mOffset, rOffset].map(frequencyToFFTOffset);
    const audioParameters = [l, m, r].map(frequencyToFFTOffset);



    // Set audio range with both normal and offset values
    audio.setAudioRange(...audioParameters, ...audioParametersOffset);
    
    updatePassband();
    updateLink();
  }

  function handleFt8Decoder(e, value) {
    ft8Enabled = value;
    audio.setFT8Decoding(value);
  }

  // Normalizes dB values to a 0-100 scale for visualization
  function normalizeDb(dbValue) {
    const minDb = -100; // Minimum expected dB value
    const maxDb = 0; // Maximum dB value (best signal)
    return ((dbValue - minDb) / (maxDb - minDb)) * 100;
  }

  function handlePassbandChange(passband) {
    let [l, m, r] = passband.detail.map(waterfallOffsetToFrequency);

    let bfo = frequencyInputComponent.getBFO();
    bfo = 0;

    l += bfo;
    m += bfo;
    r += bfo;

    // CW
    const lOffset = l - 200;
    const mOffset = m - 750;
    const rOffset = r - 200;

    bandwidth = ((r - l) / 1000).toFixed(2);
    frequencyInputComponent.setFrequency(m);
    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);

    const audioParameters = [l, m, r].map(frequencyToFFTOffset);
    const audioParametersOffset = [lOffset, mOffset, rOffset].map(frequencyToFFTOffset);

    // Set audio range with both normal and offset values
    audio.setAudioRange(...audioParameters, ...audioParametersOffset);

    updateLink();
    updatePassband();
    waterfall.checkBandAndSetMode(frequency * 1e3);
  }

  // Entering new frequency into the textbox
  function handleFrequencyChange(event) {
    

 

    const frequency = event.detail;
    const audioRange = audio.getAudioRange();
    
    const [l, m, r] = audioRange.map(FFTOffsetToFrequency);
    
    // Preserve current bandwidth settings
    let audioParameters = [
      frequency - (m - l),
      frequency,
      frequency + (r - m),
    ].map(frequencyToFFTOffset);
    const newm = audioParameters[1];


    const lOffset = frequency - (m - l) - 200;
    const mOffset = frequency - 750;
    const rOffset = frequency + (r - m) - 200;

    const audioParametersOffset = [lOffset, mOffset, rOffset].map(frequencyToFFTOffset);

    // If the ranges are not within limit, shift it back
    let [waterfallL, waterfallR] = waterfall.getWaterfallRange();
    if (newm < waterfallL || newm >= waterfallR) {
      const limits = Math.floor((waterfallR - waterfallL) / 2);
      let offset;
      if (audioRange[1] >= waterfallL && audioRange[1] < waterfallR) {
        offset = audioRange[1] - waterfallL;
      } else {
        offset = limits;
      }
      const newMid = Math.min(
        waterfall.waterfallMaxSize - limits,
        Math.max(limits, newm - offset + limits),
      );

      waterfallL = Math.floor(newMid - limits);
      waterfallR = Math.floor(newMid + limits);
      waterfall.setWaterfallRange(waterfallL, waterfallR);
    }
    audio.setAudioRange(...audioParameters, ...audioParametersOffset);
    updatePassband();
    updateLink();
    if(!event.markerclick)
    {
      waterfall.checkBandAndSetMode(frequency);
    }
    frequencyMarkerComponent.updateFrequencyMarkerPositions();
    
  }

  // Waterfall magnification controls
  function handleWaterfallMagnify(e, type) {
    let [l, m, r] = audio.getAudioRange();
    const [waterfallL, waterfallR] = waterfall.getWaterfallRange();
    const offset =
      ((m - waterfallL) / (waterfallR - waterfallL)) * waterfall.canvasWidth;
    switch (type) {
      case "max":
        m = Math.min(waterfall.waterfallMaxSize - 512, Math.max(512, m));
        l = Math.floor(m - 512);
        r = Math.ceil(m + 512);
        break;
      case "+":
        e.coords = { x: offset };
        e.scale = -1;
        waterfall.canvasWheel(e);
        updatePassband();
        frequencyMarkerComponent.updateFrequencyMarkerPositions();
        return;
      case "-":
        e.coords = { x: offset };
        e.scale = 1;
        waterfall.canvasWheel(e);
        updatePassband();
        frequencyMarkerComponent.updateFrequencyMarkerPositions();
        return;
      case "min":
        l = 0;
        r = waterfall.waterfallMaxSize;
        break;
    }
    waterfall.setWaterfallRange(l, r);
    frequencyMarkerComponent.updateFrequencyMarkerPositions();
    
    updatePassband();
  }

  let mute;
  let volume = 75;
  let squelchEnable;
  let squelch = -50;
  let power = 0;
  let powerPeak = 0;
  const numberOfDots = 35;
  const s9Index = 17;
  const accumulator = RollingMax(10);

  // Function to draw the S-meter
  function drawSMeter(value) {
    const canvas = document.getElementById("sMeter");
    const ctx = canvas.getContext("2d");

    canvas.width = 300;
    canvas.height = 40;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const segmentWidth = 6;
    const segmentGap = 3;
    const segmentHeight = 8;
    const lineY = 15;
    const labelY = 25;
    const tickHeight = 5;
    const longTickHeight = 5;

    const s9Position = width / 2;

    ctx.strokeStyle = "#a7e6fe";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(s9Position, lineY);
    ctx.stroke();

    ctx.strokeStyle = "#ed1c24";
    ctx.beginPath();
    ctx.moveTo(s9Position, lineY);
    ctx.lineTo(268, lineY);
    ctx.stroke();

    for (let i = 0; i < 30; i++) {
      const x = i * (segmentWidth + segmentGap);
      if (i < value) {
        ctx.fillStyle = i < 17 ? "#a3eced" : "#d9191c";
      } else {
        ctx.fillStyle = i < 17 ? "#003333" : "#330000";
      }
      ctx.fillRect(x, 0, segmentWidth, segmentHeight);
    }

    ctx.font = "11px monospace";
    ctx.textAlign = "center";

    const labels = ["S1", "3", "5", "7", "9", "+20", "+40", "+60dB"];

    for (let i = 0; i <= 16; i++) {
      const x = i * 16.6970588235;
      ctx.fillStyle = x <= s9Position ? "#a3eced" : "#d9191c";

      if (i % 2 === 1) {
        ctx.fillRect(x, lineY, 1, longTickHeight + 2);
        if ((i - 1) / 2 < labels.length) {
          ctx.fillText(labels[(i - 1) / 2], x, labelY + 8);
        }
      } else {
        ctx.fillRect(x, lineY, 1, tickHeight);
      }
    }
  }

  // Function to update signal strength
  function setSignalStrength(db) {
    db = Math.min(Math.max(db, -100), 0);
    const activeSegments = Math.round(((db + 100) * numberOfDots) / 100);

    drawSMeter(activeSegments);
  }

  let defaultStep = 10; // Default step value was 50, Bas ON5HB, 10 is better S-meter response.
  let currentTuneStep = 0; // Track the current step

  function setStep(step) {
    currentTuneStep = step;
  }

 let band;
 let newFrequency = 0;
 let newMode;
 let currentBand = band;

 function setBand(band,newFrequency,newMode) {
   currentBand = band;
   frequencyInputComponent.setFrequency(newFrequency * 1e3);
   handleFrequencyChange({ detail: newFrequency * 1e3 });
   SetMode(newMode);

   let [l, m, r] = audio.getAudioRange();
   const [waterfallL, waterfallR] = waterfall.getWaterfallRange();
   const offset = ((m - waterfallL) / (waterfallR - waterfallL)) * waterfall.canvasWidth;
   m = Math.min(waterfall.waterfallMaxSize - 512, Math.max(512, m));
   l = Math.floor(m - 512);
   r = Math.ceil(m + 512);
   switch (band) {
     case 2200:
       l -= 100;
       r += 100;
       break;
     case 630:
       l -= 200;
       r += 200;
       break;
     case 160:
       l -= 15000;
       r += 15000;
       break;
     case 80:
       l -= 35000;
       r += 35000;
       break;
     case 60:
       l -= 750;
       r += 750;
       break;
     case 42:
       l -= 1000;
       r += 1000;
       break;
     case 40:
       l -= 20000;
       r += 20000;
       break;
     case 31:
       l -= 1000;
       r += 1000;
       break;
     case 30:
      l -= 3300;
      r += 3300;
      break;
     case 20:
      l -= 30000;
      r += 30000;
      break;
     case 17:
       l -= 7500;
       r += 7500;
       break;
     case 15:
       l -= 35000;
       r += 35000;
       break;
     case 12:
       l -= 8000;
       r += 8000;
       break;
     case 11:
       l -= 35000;
       r += 35000;
       break;
     case 10:
       l -= 140000;
       r += 140000;
       break;
    case 49:
       l -= 5000;
       r += 5000;
       break;
    case 49.1:
       l -= 5000;
       r += 5000;
       break;
    case 642:
       l -= 5000;
       r += 5000;
       break;

    }
   waterfall.setWaterfallRange(l, r);
   frequencyMarkerComponent.updateFrequencyMarkerPositions();
   updatePassband();
}

  function handleWheel(node) {
    function onWheel(event) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -1 : 1;
      const isShiftPressed = event.shiftKey;
      const isAltPressed = event.altKey;

      // Convert frequency to Hz for calculations
      let frequencyHz = Math.round(parseFloat(frequency) * 1e3);

      function adjustFrequency(freq, direction, shiftPressed, altPressed) {
        const step = currentTuneStep || (altPressed ? 10000 : shiftPressed ? 1000 : defaultStep);
        const lastDigits = freq % step;

        if (lastDigits === 0) {
          return freq + direction * step;
        } else if (direction > 0) {
          return Math.ceil(freq / step) * step;
        } else {
          return Math.floor(freq / step) * step;
        }
      }

      
      frequencyHz = adjustFrequency(frequencyHz, delta, isShiftPressed);
      
      // Convert back to kHz and ensure 2 decimal places
      frequency = (frequencyHz / 1e3).toFixed(2);
      
      // Ensure frequency is not negative
      frequency = Math.max(0, parseFloat(frequency));
      
      frequencyInputComponent.setFrequency(frequencyHz);
      handleFrequencyChange({ detail: frequencyHz });
    }

    node.addEventListener('wheel', onWheel);

    return {
      destroy() {
        node.removeEventListener('wheel', onWheel);
      }
    };
  }


  // Bandwidth offset controls
  let bandwithoffsets = ["-1000", "-100", "+100", "+1000"];
  function handleBandwidthOffsetClick(e, bandwidthoffset) {
    bandwidthoffset = parseFloat(bandwidthoffset);
    const demodulationDefault = demodulationDefaults[demodulation].type;
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);
    if (demodulationDefault === "USB") {
      r = Math.max(m, Math.min(m + getMaximumBandwidth(), r + bandwidthoffset));
    } else if (demodulationDefault === "LSB") {
      l = Math.max(m - getMaximumBandwidth(), Math.min(m, l - bandwidthoffset));
    } else {
      r = Math.max(
        0,
        Math.min(m + getMaximumBandwidth() / 2, r + bandwidthoffset / 2),
      );
      l = Math.max(
        m - getMaximumBandwidth() / 2,
        Math.min(m, l - bandwidthoffset / 2),
      );
    }
    let audioParameters = [l, m, r].map(frequencyToFFTOffset);
    const lOffset = l - 200;
    const mOffset = m - 750;
    const rOffset = r - 200;
    const audioParametersOffset = [lOffset, mOffset, rOffset].map(frequencyToFFTOffset);

    audio.setAudioRange(...audioParameters, ...audioParametersOffset);
    updatePassband();
  }

  // Toggle buttons and slides for audio
  function handleMuteChange() {
    mute = !mute;
    audio.setMute(mute);
  }
  function handleVolumeChange() {
    audio.setGain(Math.pow(10, (volume - 50) / 50 + 2.6));
  }
  function handleSquelchChange() {
    squelchEnable = !squelchEnable;
    audio.setSquelch(squelchEnable);
  }
  function handleSquelchMove() {
    audio.setSquelchThreshold(squelch);
  }

  function handleEnterKey(event) {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent the default action
      sendMessage();
    }
  }

  let NREnabled = false;
  let NBEnabled = false;
  let ANEnabled = false;
  let CTCSSSupressEnabled = false;
  function handleNRChange() {
    NREnabled = !NREnabled;
    audio.decoder.set_nr(NREnabled);
  }
  function handleNBChange() {
    NBEnabled = !NBEnabled;
    audio.nb = NBEnabled;
    audio.decoder.set_nb(NBEnabled);
  }
  function handleANChange() {
    ANEnabled = !ANEnabled;
    audio.decoder.set_an(ANEnabled);
  }
  function handleCTCSSChange() {
    CTCSSSupressEnabled = !CTCSSSupressEnabled;
    audio.setCTCSSFilter(CTCSSSupressEnabled);
  }

  // Regular updating UI elements:
  // Other user tuning displays
  //
  let updateInterval;
  let lastUpdated = 0;

  function updateTick() {
    power = (audio.getPowerDb() / 150) * 100 + audio.smeter_offset;
    powerPeak = (accumulator(power) / 150) * 100 + audio.smeter_offset;

    setSignalStrength(power);

    if (events.getLastModified() > lastUpdated) {
      const myRange = audio.getAudioRange();
      const clients = events.getSignalClients();
      // Don't show our own tuning
      // Find the id that is closest to myRange[i]
      const myId = Object.keys(clients).reduce((a, b) => {
        const aRange = clients[a];
        const bRange = clients[b];
        const aDiff = Math.abs(aRange[1] - myRange[1]);
        const bDiff = Math.abs(bRange[1] - myRange[1]);
        return aDiff < bDiff ? a : b;
      });
      delete clients[myId];
      waterfall.setClients(clients);
      requestAnimationFrame(() => {
        waterfall.updateGraduation();
        waterfall.drawClients();
      });
      lastUpdated = events.getLastModified();
    }
  }

  // Tune to the frequency when clicked
  let frequencyMarkerComponent;
  function handleFrequencyMarkerClick(event) {
    handleFrequencyChange({ detail: event.detail.frequency,  markerclick: true });

          
      // Convert back to kHz and ensure 2 decimal places
      frequency = (event.detail.frequency / 1e3).toFixed(2);
      
      // Ensure frequency is not negative
      frequency = Math.max(0, parseFloat(frequency));
      
      frequencyInputComponent.setFrequency(event.detail.frequency);


    SetMode(event.detail.modulation);
    //demodulation = event.detail.modulation;
    //handleDemodulationChange();
  }

  // Permalink handling
  function updateLink() {
    const linkObj = {
      frequency: frequencyInputComponent.getFrequency().toFixed(0),
      modulation: demodulation,
    };
    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);
    const linkQuery = constructLink(linkObj);
    link = `${location.origin}${location.pathname}?${linkQuery}`;
    storeInLocalStorage(linkObj);
  }
  function handleLinkCopyClick() {
    copy(link);
  }

  let bookmarks = writable([]);
  let newBookmarkName = "";

  let messages = writable([]);
  let newMessage = "";
  let socket;
  


  let username = `user${Math.floor(Math.random() * 10000)}`;
  let showUsernameInput  = false;



  function saveUsername() {
    localStorage.setItem('chatusername', username);
    showUsernameInput  = false;
  }

  function editUsername() {
    showUsernameInput  = true;
  }

  const formatMessage = (text) => {
    const now = new Date();
    return `${username}: ${text.substring(0, 500)}`; // Ensure message is capped at 25 chars
  };




  function addBookmark() {
    const bookmark = {
      name: newBookmarkName,
      link: link,
      frequency: frequencyInputComponent.getFrequency(),
      demodulation: demodulation,
    };
    frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(2);
    bookmarks.update((currentBookmarks) => {
      const updatedBookmarks = [...currentBookmarks, bookmark];
      localStorage.setItem("bookmarks", JSON.stringify(updatedBookmarks));
      return updatedBookmarks;
    });
    newBookmarkName = "";
  }

  function goToBookmark(bookmark) {
    // Set frequency
    frequencyInputComponent.setFrequency(bookmark.frequency);
    handleFrequencyChange({ detail: bookmark.frequency });

    // Set demodulation
    demodulation = bookmark.demodulation;
    handleDemodulationChange(null, true);

    // Update the link
    updateLink();
  }

  function copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text).then(() => {
        console.log("Text copied to clipboard!");
      });
    } catch (err) {
      console.error("Clipboard write failed", err);
    }
  }

  function deleteBookmark(index) {
    bookmarks.update((currentBookmarks) => {
      const updatedBookmarks = currentBookmarks.filter((_, i) => i !== index);
      saveBookmarks(updatedBookmarks);
      return updatedBookmarks;
    });
  }

  function saveBookmarks(bookmarksToSave) {
    localStorage.setItem("bookmarks", JSON.stringify(bookmarksToSave));
  }

  let showBookmarkPopup = false;

  function toggleBookmarkPopup() {
    showBookmarkPopup = !showBookmarkPopup;
  }


  let currentStep = 0;
  let showTutorial = false;
  let isFirstTime = false;
  let highlightedElement = null;
  let highlightPosition = { top: 0, left: 0, width: 0, height: 0 };


  const tutorialSteps = [
    {
      selector: "#demodulator-select",
      content: "Welcome to PhantomSDR - This is the Tutorial.",
    },

    {
      selector: "#waterfall",
      content: "This is the Waterfall, the main part of a WebSDR where you see all signals visuallly.",
    },

    {
      selector: "#volume-slider",
      content: "Use this Slider to change the Volume.",
    },
    {
      selector: "#squelch-slider",
      content: "Use this Slider to change the Squelch.",
    },
    {
      selector: "#ft8-decoder",
      content: "This Button lets you Decode FT8 Signals, if you are on the proper Frequency"
    },
    {
      selector: "#smeter-tut",
      content: "This Section shows you the S-Meter, lets you Input the Frequency and shows the Mode with Filter Bandwidth.",
    },
    {
      selector: "#demodulationModes",
      content: "Use this Section to change the Demodulation Mode.",
    },
    
    {
      selector: "#zoom-controls",
      content: "Use these buttons to zoom in and out of the waterfall display.",
    },
    {
    	selector: "#frequency-step-selection",
	content: "Use these buttons to change the frequency steps.",
    },
    {
    	selector: "#band-selection",
	content: "Use these buttons to change bands.",
    },
    {
      selector: "#moreoptions",
      content:
        "These options allow you to enable things like CTCSS Supression, Noise Reduction and more.",
    },
    {
      selector: "#brightness-controls",
      content: "Adjust the brightness levels of the waterfall display.",
    },
    {
      selector: "#colormap-select",
      content: "Choose different color schemes for the waterfall.",
    },
    {
      selector: "#auto-adjust",
      content: "Toggle automatic adjustment of the waterfall display.",
    },
    {
      selector: "#spectrum-toggle",
      content: "Turn the spectrum display on or off.",
    },
    {
      selector: "#bigger-waterfall",
      content: "Increase the size of the waterfall display.",
    },
    {
      selector: "#bookmark-button",
      content: "Click this to open the Bookmarks Menu.",
    },
    {
      selector: "#chat-box",
      content: "This is the Chatbox, where to communicae with other users and sending Frequencies"
    },
    {
      selector: "#chat-box",
      content: "Thank you for completing the Tutorial, now you can use the WebSDR as you wish. Enjoy!"
    },
    
    
  ];

  async function initTutorial() {
    if (!localStorage.getItem("TutorialComplete")) {
      await tick();
      const allElementsPresent = tutorialSteps.every((step) =>
        document.querySelector(step.selector)
      );
      if (allElementsPresent) {
        showTutorial = true;
        isFirstTime = true;
        updateHighlightedElement();
      } else {
        console.warn("Some tutorial elements are missing. Skipping tutorial.");
        localStorage.setItem("TutorialComplete", "true");
      }
    }
  }


  function updateHighlightedElement() {
    const { selector } = tutorialSteps[currentStep];
    highlightedElement = selector ? document.querySelector(selector) : null;
    if (highlightedElement) {
      var rect = highlightedElement.getBoundingClientRect();
      highlightPosition = {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      };

      // Smooth scroll only if the element is not fully visible
      const elementTop = rect.top;
      const elementBottom = rect.bottom;
      const viewportHeight = window.innerHeight;

      if (elementTop < 0 || elementBottom > viewportHeight) {
        highlightedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }

      rect = highlightedElement.getBoundingClientRect();
      highlightPosition = {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      };
    }
  }

  
  async function nextStep() {
    if (currentStep < tutorialSteps.length - 1) {
      currentStep += 1;
      await tick();
      updateHighlightedElement();
      if (currentStep == 7) {
        activeTab = "waterfall";
      }
    } else {
      endTutorial();
    }
  }


  function endTutorial() {
    showTutorial = false;
    localStorage.setItem("TutorialComplete", "true");
  }

  initTutorial();

  let backendPromise;
  onMount(async () => {

    if (!localStorage.getItem("TutorialComplete")) {
      await tick();
      const allElementsPresent = tutorialSteps
        .slice(1)
        .every((step) => document.querySelector(step.selector));
      if (allElementsPresent) {
	isFirstTime = true;
        showTutorial = true;
        await updateHighlightedElement();
      } else {
        console.warn("Some tutorial elements are missing. Skipping tutorial.");
        localStorage.setItem("TutorialComplete", "true");
      }
    }

    waterfall.initCanvas({
      canvasElem: waterfallCanvas,
      spectrumCanvasElem: spectrumCanvas,
      graduationCanvasElem: graduationCanvas,
      bandPlanCanvasElem: bandPlanCanvas,
      tempCanvasElem: tempCanvas,
    });

    backendPromise = init();

    await backendPromise;

    waterfall.setFrequencyMarkerComponent(frequencyMarkerComponent);

    // Enable after connection established
    [
      ...document.getElementsByTagName("button"),
      ...document.getElementsByTagName("input"),
    ].forEach((element) => {
      element.disabled = false;
    });


    // Enable WBFM option if bandwidth is wide enough
    if (audio.trueAudioSps > 170000) {
      demodulators.push("WBFM");
      demodulators = demodulators;
      bandwithoffsets.unshift("-100000");
      bandwithoffsets.push("+100000");
      bandwithoffsets = bandwithoffsets;
    }

    frequencyInputComponent.setFrequency(
      FFTOffsetToFrequency(audio.getAudioRange()[1]),
    );
    frequencyInputComponent.updateFrequencyLimits(
      audio.baseFreq,
      audio.baseFreq + audio.totalBandwidth,
    );



    username = localStorage.getItem('chatusername') || '';
    if(!username) {
      console.log("No Username. Setting a random username.");
      username = `user${Math.floor(Math.random() * 10000)}`
    }
    showUsernameInput  = !username;

    
 

    demodulation = audio.settings.defaults.modulation;

    const updateParameters = (linkParameters) => {
      frequencyInputComponent.setFrequency(linkParameters.frequency);
      if (frequencyInputComponent.getFrequency() === linkParameters.frequency) {
        handleFrequencyChange({ detail: linkParameters.frequency });
      }
      if (demodulators.indexOf(linkParameters.modulation) !== -1) {
        demodulation = linkParameters.modulation;
        handleDemodulationChange({}, true);
      }
      frequencyMarkerComponent.updateFrequencyMarkerPositions();
    };

    /* const storageParameters = loadFromLocalStorage()
    updateParameters(storageParameters) */
    const linkParameters = parseLink(location.search.slice(1));
    updateParameters(linkParameters);



    // Refresh all the controls to the initial value
    updatePassband();
    passbandTunerComponent.updatePassbandLimits();
    //handleWaterfallColormapSelect();
    initializeColormap();
    handleDemodulationChange({}, true);
    handleSpectrumChange();
    handleVolumeChange();
    updateLink();
    userId = generateUniqueId();
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);

    const storedBookmarks = localStorage.getItem("bookmarks");
    if (storedBookmarks) {
      bookmarks.set(JSON.parse(storedBookmarks));
    }

    updateInterval = setInterval(() => requestAnimationFrame(updateTick), 200);


    window["spectrumAudio"] = audio;
    window["spectrumWaterfall"] = waterfall;

    
     socket = new WebSocket(
      window.location.origin.replace(/^http/, "ws") + "/chat",
    );
    
    chatContentDiv = document.getElementById("chat_content");



    socket.onmessage = (event) => {
      if (event.data.startsWith("Chat history:")) {
        const history = event.data.replace("Chat history:\n", "").trim();
        if (history) {
          const historyMessages = history.split("\n").map((line, index) => ({
            id: Date.now() + index,
            text: line.trim(),
            isCurrentUser: line.startsWith(userId),
            timestamp: Date.now() - (history.length - index) * 1000, // Approximate timestamp
          }));
          messages.set(historyMessages);
        }
      } else {
        const receivedMessageObject = {
          id: Date.now(),
          text: event.data.trim(),
          isCurrentUser: event.data.startsWith(userId),
          timestamp: Date.now(),
        };
        messages.update((currentMessages) => [
          ...currentMessages,
          receivedMessageObject,
        ]);
      }
      scrollToBottom();
    };

    const middleColumn = document.getElementById('middle-column');
    const chatBox = document.getElementById('chat-box');
    
    function setWidth() {
      const width = middleColumn.offsetWidth;
      document.documentElement.style.setProperty('--middle-column-width', `1372px`);
    }

    setWidth();
    window.addEventListener('resize', setWidth);

    
    eventBus.subscribe('frequencyClick', ({ frequency, mode }) => {
      handleFrequencyClick(frequency, mode);
    });

    eventBus.subscribe('frequencyChange', (event) => {
      frequencyInputComponent.setFrequency(event.detail );
      frequency = (event.detail / 1e3).toFixed(2);
      handleFrequencyChange(event);
    });

    eventBus.subscribe('setMode', (mode) => {
      SetMode(mode);
    });

    return () => {
      window.removeEventListener('resize', setWidth);
    };

    
  });

  function sendMessage() {
    if (newMessage.trim() && username.trim()) {
      const messageObject = {
        cmd: "chat",
        message: newMessage.trim(),
        username: username
      };
      socket.send(JSON.stringify(messageObject));
      newMessage = "";
      scrollToBottom();
    }
  }

  function pasteFrequency() {
    const frequency = frequencyInputComponent.getFrequency();
    const currentDemodulation = demodulation;
    const frequencyText = `[FREQ:${Math.round(frequency)}:${currentDemodulation}]`;
    newMessage = newMessage + " " + frequencyText; // Append the frequency to the current message
  }

  function shareFrequency() {
    const frequency = frequencyInputComponent.getFrequency();
    const currentDemodulation = demodulation;
    const shareMessage = `[FREQ:${Math.round(frequency)}:${currentDemodulation}] Check out this frequency!`;
    const messageObject = {
      cmd: "chat",
      message: shareMessage,
      userid: userId,
    };
    socket.send(JSON.stringify(messageObject));
    scrollToBottom();
  }

  let chatMessages;

  function scrollToBottom() {
    if (chatMessages) {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  $: {
    if ($messages) {
      setTimeout(scrollToBottom, 100);
    }
  }

  // Function to handle clicking on a shared frequency
  function handleFrequencyClick(frequency, mode) {
    demodulation = mode;
    const numericFrequency = parseInt(frequency, 10);
    if (isNaN(numericFrequency)) {
      console.error("Invalid frequency:", frequency);
      return;
    }
    frequencyInputComponent.setFrequency(numericFrequency);
    handleFrequencyChange({ detail: numericFrequency });
    
    handleDemodulationChange(null, true);
    updateLink();
  }

  function sanitizeHtml(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }

  function formatFrequencyMessage(text) {
      const regex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+?): (.+)$/;
      const match = text.match(regex);
      if (match) {
          const [_, timestamp, username, message] = match;
          const freqRegex = /\[FREQ:(\d+):([\w-]+)\]/;
          const freqMatch = message.match(freqRegex);
          if (freqMatch) {
              const [fullMatch, frequency, demodulation] = freqMatch;
              const [beforeFreq, afterFreq] = message.split(fullMatch).map(part => formatLinks(sanitizeHtml(part)));
              return {
                  isFormatted: true,
                  timestamp: sanitizeHtml(timestamp),
                  username: sanitizeHtml(username),
                  frequency: parseInt(frequency, 10),
                  demodulation: sanitizeHtml(demodulation),
                  beforeFreq,
                  afterFreq,
              };
          }
          return {
              isFormatted: false,
              timestamp: sanitizeHtml(timestamp),
              username: sanitizeHtml(username),
              parts: formatLinks(sanitizeHtml(message)),
          };
      }
      return {
          isFormatted: false,
          parts: formatLinks(sanitizeHtml(text)),
      };
  }


  function formatLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'link', content: match[0], url: match[0] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts;
  }

  function renderParts(parts) {
      return parts.map(part => {
          if (part.type === 'link') {
              return `<a href="${sanitizeHtml(part.url)}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">${sanitizeHtml(part.content)}</a>`;
          }
          return part.content;
      }).join('');
  }

  onDestroy(() => {
    // Stop everything
    clearInterval(updateInterval);
    audio.stop();
    waterfall.stop();
    socket.close();
  });

  // Mobile gestures
  // Pinch = Mousewheel = Zoom
  let pinchX = 0;
  function handleWaterfallPinchStart(e) {
    pinchX = 0;
  }
  function handleWaterfallPinchMove(e) {
    const diff = e.detail.scale - pinchX;
    pinchX = e.detail.scale;
    const scale =
      1 -
      Math.abs(e.detail.srcEvent.movementX) /
        waterfallCanvas.getBoundingClientRect().width;
    const evt = e.detail.srcEvent;
    evt.coords = { x: e.detail.center.x };
    evt.deltaY = -Math.sign(diff);
    evt.scaleAmount = scale;
    waterfall.canvasWheel(evt);
    updatePassband();
    // Prevent mouseup event from firing
    waterfallDragTotal += 2;
  }
  // Pan = Mousewheel = waterfall dragging
  function handleWaterfallPanMove(e) {
    if (e.detail.srcEvent.pointerType === "touch") {
      waterfall.mouseMove(e.detail.srcEvent);
      updatePassband();
    }
  }
</script>

<svelte:window on:mousemove={handleWindowMouseMove} on:mouseup={handleWindowMouseUp}
/>

<main class="custom-scrollbar">
  
  <div class="h-screen overflow-hidden flex flex-col min-h-screen">
    
    <div
      class="w-full sm:h-screen overflow-y-scroll sm:w-1/2 xl:w-1/3 lg:w-1/4 sm:transition-all sm:ease-linear sm:duration-100"
      style="width:100%;"
    >
      <div
        class="min-h-screen bg-custom-dark text-gray-200"
        style="padding-top: 10px;"
      >
        <div class="max-w-screen-lg mx-auto">

          
     
      <div class="xl:pt-20"></div>

          <!--Titel Box with Admin Infos, to be personalized-->
          <div class="flex flex-col rounded p-2 justify-center" id="chat-column">
            <div class="p-3 sm:p-5 flex flex-col bg-gray-800 border border-gray-700 rounded-lg w-full mb-8" id="chat-box" style="opacity: 0.85;">
              <!-- Header -->
              <h2 class="text-xl sm:text-2xl font-semibold text-gray-100 mb-2 sm:mb-4">
                <span>
                  Heppen Wideband Websdr @ JO21oc:
                  <a href="https://k7fry.com/grid/?qth=JO21oc" class="text-blue-500 hover:underline" target="_blank">click on JO21oc</a>
                </span>
              </h2>

              <!-- Details -->
              <span class="text-white text-xs sm:text-sm mr-4 mb-2 sm:mb-0">
                Operated by Bas ON5HB and Marian ON3MS, e-mail:
                <a href="mailto:on5hb@heppen.be?subject=WebSDR" class="font-bold text-blue-500 hover:underline">on5hb@heppen.be</a>&nbsp; Other PhantomSDR+ WebSDR servers at
                <a href="https://sdr-list.xyz/" class="font-bold text-blue-500 hover:underline" target="_blank">sdr-list.xyz</a>
              </span>

              <form style="margin-top: 15px;" method="get" target="_blank" action="https://www.qrz.com/lookup">
                <span class="text-white text-xs sm:text-sm mr-4 mb-2 sm:mb-0"><b>QRZ Callsign lookup: &nbsp;&nbsp;</b></span>
                <input class="glass-username text-white text-xs sm:text-sm px-3 py-1 rounded-lg mr-2 mb-2 sm:mb-0" type="text" name="callsign" value="" size="6" onClick="this.form.q.select();this.form.q.focus()" />&nbsp;&nbsp;&nbsp;
                <input type="hidden" name="action" value="search" />
                <input class="glass-button text-white py-1 px-3 mb-2 lg:mb-0 rounded-lg text-xs sm:text-sm" type="submit" name="page" value="Search" />
              </form>

              <!-- Collapsible Menu -->
              <div>
                <!-- Toggle Button -->
                <center>
                  <button class="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg flex items-center transition-colors ring-2 ring-blue-500 s-XsEmFtvddWTw" onclick="toggleMenu()" style="margin-top: 15px;">
                    <span id="menu-toggle-label">Open Additional Info</span>
                  </button>
                </center>

                <!-- Collapsible Content -->
                <div id="collapsible-menu" class="hidden mt-3 bg-gray-700 p-3 rounded">
                  <ul style="font-size: 0.91rem; text-align: left;">
                    <b>Setup &amp; Configuration:</b>
                    <br />
                    <span style="/*text-decoration: line-through*/">Hardware: Intel i5-7500 16GBram, RX888MKII Receiver and a Long-wire 54m long as an inverted-V max height about 20m above ground</span>
                    <br />
                    <span style="/*text-decoration: line-through*/">Software: Ubuntu 22 Server, PhantomSDR+ v1.5.4, compiled with OpenCL Support</span>
                    <br />
                    <br />
                    <br />
                    <div style="font-weight: bold;">Current band propagation</div>
                    <div style="display: flex; align-items: center; margin-top: 10px;">
                      <a href="https://www.hamqsl.com/solar.html" title="Click for more information">
                        <img alt="Solar propagation" src="https://www.hamqsl.com/solar101vhf.php" />
                      </a>
                      <br />
                    </div>
                    <br />
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <script>
            // JavaScript function to toggle the menu
            function toggleMenu() {
              const menu = document.getElementById("collapsible-menu");
              const label = document.getElementById("menu-toggle-label");

              if (menu.classList.contains("hidden")) {
                menu.classList.remove("hidden");
                label.innerText = "Close Additional Info";
              } else {
                menu.classList.add("hidden");
                label.innerText = "Open Additional Info";
              }
            }
          </script>

          <style>
            .hidden {
              display: none;
            }
          </style>
          <!--End of Titel Box -->


<div class="flex justify-center w-full" >
        <div class="w-full" id="outer-waterfall-container"> 
      <div
        style="image-rendering:pixelated;"
        class="w-full xl:rounded-lg   peer overflow-hidden"
        id="waterfall"
      >
      <canvas
      class="w-full bg-black peer {spectrumDisplay ? 'max-h-40' : 'max-h-0'}"
      bind:this={spectrumCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={passbandTunerComponent.handlePassbandClick}
      width="1024"
      height="128"
    ></canvas>
        <canvas
          class="w-full  bg-black {waterfallDisplay ? 'block' : 'hidden'}"
          bind:this={waterfallCanvas}
          use:pinch
          on:pinchstart={handleWaterfallPinchStart}
          on:pinchmove={handleWaterfallPinchMove}
          use:pan
          on:panmove={handleWaterfallPanMove}
          on:wheel={handleWaterfallWheel}
          on:mousedown={handleWaterfallMouseDown}
          width="1024"
        ></canvas>
        <canvas class="hidden" bind:this={tempCanvas} width="1024" height="1024"
        ></canvas>
        <FrequencyInput
      bind:this={frequencyInputComponent}
      on:change={handleFrequencyChange}
    ></FrequencyInput>

    <FrequencyMarkers
    bind:this={frequencyMarkerComponent}
    on:click={passbandTunerComponent.handlePassbandClick}
    on:wheel={handleWaterfallWheel}
    on:markerclick={handleFrequencyMarkerClick}
  ></FrequencyMarkers>
  <canvas
  class="w-full bg-black peer"
  bind:this={graduationCanvas}
  on:wheel={handleWaterfallWheel}
  on:click={passbandTunerComponent.handlePassbandClick}
  on:mousedown={(e) => passbandTunerComponent.handleMoveStart(e, 1)}
  on:touchstart={passbandTunerComponent.handleTouchStart}
  on:touchmove={passbandTunerComponent.handleTouchMove}
  on:touchend={passbandTunerComponent.handleTouchEnd}
  width="1024"
  height="20"
></canvas>
    <PassbandTuner
      on:change={handlePassbandChange}
      on:wheel={handleWaterfallWheel}
      bind:this={passbandTunerComponent}
    ></PassbandTuner>
    <canvas
      class="w-full bg-black peer"
      bind:this={bandPlanCanvas}
      on:wheel={handleWaterfallWheel}
      on:click={passbandTunerComponent.handlePassbandClick}
      on:mousedown={(e) => passbandTunerComponent.handleMoveStart(e, 1)}
      on:touchstart={passbandTunerComponent.handleTouchStart}
      on:touchmove={passbandTunerComponent.handleTouchMove}
      on:touchend={passbandTunerComponent.handleTouchEnd}
      width="1024"
      height="20"
    >
      </div>
    </div>
  </div>

            <div
            class="absolute inset-0 z-20 bg-black bg-opacity-40 backdrop-filter backdrop-blur-sm transition-opacity duration-300 ease-in-out cursor-pointer flex justify-center items-center"
            id="startaudio"

          >
            <div class="text-center p-4 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-2 text-white opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
              <p class="text-white text-lg font-medium">
                Tap to enable audio
              </p>
            </div>
          </div>

          {#if showTutorial}
          <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
            on:click|self={nextStep}
            transition:fade={{ duration: 300 }}
          >
            {#key currentStep}
              {#if highlightedElement}
                <div
                  class="absolute bg-blue-500 bg-opacity-20 border-2 border-blue-500 transition-all duration-300 ease-in-out pointer-events-none"
                  style="
                    top: {highlightPosition.top}px;
                    left: {highlightPosition.left}px;
                    width: {highlightPosition.width}px;
                    height: {highlightPosition.height}px;
                  "
                  transition:scale={{ duration: 300, start: 0.95 }}
                ></div>
              {/if}
            {/key}
        
            <div
              class="fixed bottom-4 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 bg-gray-800 text-white p-4 sm:p-6 rounded-lg shadow-lg max-w-md text-center backdrop-filter backdrop-blur-lg bg-opacity-90 border border-gray-700"
              transition:fly={{ y: 50, duration: 300 }}
            >
              <h3 class="text-lg sm:text-xl font-semibold mb-2">Step {currentStep + 1} of {tutorialSteps.length}</h3>
              <p class="mb-4 text-sm sm:text-lg">{tutorialSteps[currentStep].content}</p>
              <div class="flex flex-col sm:flex-row justify-between space-y-2 sm:space-y-0 sm:space-x-4">
                <button
                  class="w-full sm:w-auto px-4 sm:px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
                  on:click|stopPropagation={endTutorial}
                >
                  Skip Tutorial
                </button>
                <button
                  class="w-full sm:w-auto px-4 sm:px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
                  on:click|stopPropagation={nextStep}
                >
                  {currentStep < tutorialSteps.length - 1 ? "Next" : "Finish"}
                </button>
              </div>
            </div>
          </div>
        {/if}

          <!-- alles neu  -->

          <div class="flex flex-col xl:flex-row rounded p-5 justify-center rounded"  id="middle-column">
              <div class="p-5 flex flex-col items-center bg-gray-800 lg:border lg:border-gray-700 rounded-none rounded-t-lg lg:rounded-none lg:rounded-l-lg">
            
              <h2 class="text-2xl font-semibold text-gray-100 mb-6">Audio</h2>
              <div class="control-group" id="volume-slider">
                <button
                  class="glass-button text-white font-bold rounded-full w-10 h-10 flex items-center justify-center mr-4"
                  on:click={handleMuteChange}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
                    {#if mute}
                      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM17.78 9.22a.75.75 0 10-1.06 1.06L18.44 12l-1.72 1.72a.75.75 0 001.06 1.06L19.5 13.06l1.72 1.72a.75.75 0 101.06-1.06L20.56 12l1.72-1.72a.75.75 0 00-1.06-1.06L19.5 10.94l-1.72-1.72z" />
                    {:else}
                      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                    {/if}
                  </svg>
                </button>
                <div class="slider-container">
                  <input
                    type="range"
                    bind:value={volume}
                    on:input={handleVolumeChange}
                    class="glass-slider"
                    disabled={mute}
                    min="0"
                    max="100"
                    step="1"
                  />
                </div>
                <span  class="value-display text-gray-300 ml-4">{volume}%</span>
              </div>

              <div class="control-group mt-4" id="squelch-slider">
                <button
                  class="glass-button text-white font-bold rounded-full w-10 h-10 flex items-center justify-center mr-4"
                  style="background: {squelchEnable ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)'}"
                  on:click={handleSquelchChange}
                >
                  <span class="text-xs font-semibold">SQ</span>
                </button>
                <div class="slider-container">
                  <input
                    type="range"
                    bind:value={squelch}
                    on:input={handleSquelchMove}
                    class="glass-slider"
                    min="-150"
                    max="0"
                    step="1"
                  />
                </div>
                <span class="value-display text-gray-300 ml-4">{squelch}db</span>
              </div>
              <!-- Decoder Options -->
              <div class="mt-6">
                <label class="block text-sm font-medium text-gray-300 mb-3">Decoder Options</label>
                <div class="flex justify-center gap-4">
                  <button
                    class="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg flex items-center transition-colors {!ft8Enabled ? 'ring-2 ring-blue-500' : ''}"
                    on:click={(e) => handleFt8Decoder(e, false)}
                  >
                    None
                  </button>
                  <button
                    id="ft8-decoder"
                    class="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg flex items-center transition-colors {ft8Enabled ? 'ring-2 ring-blue-500' : ''}"
                    on:click={(e) => handleFt8Decoder(e, true)}
                  >
                    FT8
                  </button>
                </div>
              </div>

              <!-- FT8 Messages List -->
              {#if ft8Enabled}
              <div class="bg-gray-700 rounded-lg p-4 mt-6">
                <div class="flex justify-between items-center mb-3 text-sm">
                  <h4 class="text-white font-semibold">FT8 Messages</h4>
                  <span class="text-gray-300 pl-4 lg:pl-0" id="farthest-distance">Farthest: 0 km</span>
                </div>
                <div class="text-gray-300 overflow-auto max-h-40 custom-scrollbar pr-2">
                  <div id="ft8MessagesList">
                    <!-- Dynamic content populated here -->
                  </div>
                </div>
              </div>
            {/if}

             <!-- Recording Options -->
            <div class="mt-6 w-full">
              <label class="block text-sm font-medium text-gray-300 mb-3">Recording Options</label>
              <div class="flex justify-center gap-4">
                <button
                  class="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg flex items-center transition-colors {isRecording ? 'ring-2 ring-red-500' : ''}"
                  on:click={toggleRecording}
                >
                  {#if isRecording}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" />
                    </svg>
                    Stop
                  {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                    </svg>
                    Record
                  {/if}
                </button>
                
                {#if canDownload}
                  <button
                    class="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg flex items-center transition-colors"
                    on:click={downloadRecording}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                    Download
                  </button>
                {/if}
              </div>
            </div>
           </div>

            <div class="flex flex-col items-center bg-gray-800 p-6 border-l-0 border-r-0 border border-gray-700">
              <div class="bg-black rounded-lg p-8 min-w-80 lg:min-w-0 lg:p-4 mb-4 w-full" id="smeter-tut">
                <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div class="flex flex-col items-center">
                    <input
                      class="text-4xl h-16 w-48 text-center bg-black text-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 rounded-lg mb-2"
                      type="text"
                      bind:value={frequency}
                      size="3"
                      name="frequency"
                      on:keydown={(e) => {
                        if (e.key === 'Enter') {
                          frequencyInputComponent.setFrequency(frequency * 1e3);
                          handleFrequencyChange({ detail: frequency * 1e3 });
                        }
                      }}
                      use:handleWheel
                    />
                    <div class="flex items-center justify-center text-sm w-48">
                      <span class="text-green-400 px-2">{demodulation}</span>
                      <span class="text-gray-400 px-2">|</span>
                      <span class="text-cyan-300 px-2">BW {bandwidth} kHz</span>
                    </div>
                  </div>
            
                  <div class="flex flex-col items-center">
                    <div class="flex space-x-1 mb-1">
                      {#each [
                        { label: 'MUTED', enabled: mute, color: 'red' },
                        { label: 'NR', enabled: NREnabled, color: 'green' },
                        { label: 'NB', enabled: NBEnabled, color: 'green' },
                        { label: 'AN', enabled: ANEnabled, color: 'green' }
                      ] as indicator}
                        <div class="px-1 py-0.5 flex items-center justify-center w-12 h-5 relative overflow-hidden">
                          <span class={`text-xs font-mono ${indicator.enabled ? `text-${indicator.color}-500` : `text-${indicator.color}-500 opacity-20`} relative z-10`}>
                            {indicator.label}
                          </span>
                        </div>
                      {/each}
                    </div>
                    <!-- SMeter -->
                    <canvas id="sMeter" width="250" height="40"></canvas>
                  </div>
                </div>
              </div>

<!--START-->
<!-- Band Selection -->
                  <div>
                    <h3 class="text-white text-lg font-semibold mb-2">Band Selection</h3>

                    <div id="band-selection" class="grid grid-cols-2 sm:grid-cols-8 gap-3">

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 2200 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(2200,136,"USB")} title="2200 meters" > 2200m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 630 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(630,474.2,"USB")} title="630 meters" > 630m </button>

		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 160 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(160,1900,"LSB")} title="160 meters" > 160m </button>
		      
		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 80 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(80,3700,"LSB")} title="80 meters" > 80m </button>
		      
		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 60 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(60,5358,"USB")} title="60 meters" > 60m </button>

		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 40 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(40,7100,"LSB")} title="40 meters" > 40m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 30 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(30,10125,"CW")} title="30 meters" > 30m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 20 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(20,14175,"USB")} title="20 meters" > 20m </button>


</div><br>
<div>
	              <div id="band-selection" class="grid grid-cols-2 sm:grid-cols-8 gap-3">
                                            
		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 17 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(17,18120,"USB")} title="17 meters" > 17m </button>
                                         
		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 15 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(15,21225,"USB")} title="15 meters" > 15m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 12 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(12,24940,"USB")} title="12 meters" > 12m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 11 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(11,27200,"LSB")} title="11 meters" > 11m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 10 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}" 
                      on:click={() => setBand(10,28900,"USB")} title="10 meters" > 10m </button>

                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 642 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}" 
                      on:click={() => setBand(642,648,"AM")} title="Caroline" > Caro </button>
		      
                      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 49 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(49,5955,"AM")} title="Veronica" > Vero </button>
		      
		      <button class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentBand === 49.1 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                      on:click={() => setBand(49.1,6085,"AM")} title="MiAmigo" > MiAm </button>
</div>
</div>
</div>

 <hr class="border-gray-600 my-2">              
              <div id="frequencyContainer" class="w-full mt-4">
                <div class="space-y-3">
		<h3 class="text-white text-lg font-semibold mb-2">Mode Selection</h3>
                  <!-- Demodulation -->
                  <div class="flex justify-center">
                    <div id="demodulationModes" class="grid grid-cols-3 sm:grid-cols-5 gap-2 w-full max-w-md">
                      {#each ['USB', 'LSB', 'CW', 'AM', 'FM'] as mode}
                        <button
                          on:click={() => SetMode(mode)}
                          class="retro-button text-white font-bold h-10 text-sm rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {demodulation === mode ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                        >
                          {mode}
                        </button>
                      {/each}
                    </div>
                  </div>
                  
           
                  <hr class="border-gray-600 my-2">

<!--START-->
<!-- Tuning Setep -->
                  <div>
                    <h3 class="text-white text-lg font-semibold mb-2">Frequency Step Selection</h3>
                    <div id="frequency-step-selection" class="grid grid-cols-2 sm:grid-cols-5 gap-2">
		      <button
		      class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentTuneStep === 500 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
		      on:click={() => setStep(500)}
		      title="Off"
		      >
		      Default
		      </button>

                      <button
		      class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentTuneStep === 1000 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
		      on:click={() => setStep(1000)}
		      title="1 kHz"
		      >
		      1 kHz
		      </button>

                      <button
		      class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentTuneStep === 10000 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
		      on:click={() => setStep(10000)}
		      title="10 kHz"
		      >
		      10 kHz
		      </button>
                      <button
		      class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentTuneStep === 100000 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
		      on:click={() => setStep(100000)}
		      title="100 kHz"
		      >
		      100 kHz
		      </button>
                      <button
		      class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {currentTuneStep === 1000000 ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
		      on:click={() => setStep(1000000)}
		      title="1 MHz"
		      >
		      1 MHz
		      </button>
		</div>
		</div>
<!--END-->		    
           <hr class="border-gray-600 my-2"> 
                  <!-- Zoom Controls and Misc in a single row -->
                  <div class="grid sm:grid-cols-2 gap-4">
                    <!-- Zoom Controls -->
                    <div>
                      <h3 class="text-white text-lg font-semibold mb-2">Zoom</h3>
                      <div id="zoom-controls" class="grid grid-cols-2 gap-2">
                        {#each [
                          { action: '+', title: 'Zoom in', icon: 'zoom-in', text: 'In' },
                          { action: '-', title: 'Zoom out', icon: 'zoom-out', text: 'Out' },
                          { action: 'max', title: 'Zoom to max', icon: 'maximize', text: 'Max' },
                          { action: 'min', title: 'Zoom to min', icon: 'minimize', text: 'Min' }
                        ] as { action, title, icon, text }}
                          <button
                            class="retro-button text-white font-bold h-10 text-sm rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out bg-gray-700 hover:bg-gray-600"
                            on:click={(e) => handleWaterfallMagnify(e, action)}
                            {title}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              {#if icon === 'zoom-in'}
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                <line x1="11" y1="8" x2="11" y2="14" />
                                <line x1="8" y1="11" x2="14" y2="11" />
                              {:else if icon === 'zoom-out'}
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                <line x1="8" y1="11" x2="14" y2="11" />
                              {:else if icon === 'maximize'}
                                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                              {:else if icon === 'minimize'}
                                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                              {/if}
                            </svg>
                            <span>{text}</span>
                          </button>
                        {/each}
                      </div>
                    </div>
            
                    <!-- Misc -->
                    <div>
                      <h3 class="text-white text-lg font-semibold mb-2">Misc</h3>
                      <div id="moreoptions" class="grid grid-cols-2 gap-2">
                        {#each [
                          { option: 'NR', icon: 'wave-square', enabled: NREnabled },
                          { option: 'NB', icon: 'zap', enabled: NBEnabled },
                          { option: 'AN', icon: 'shield', enabled: ANEnabled },
                          { option: 'CTCSS', icon: 'filter', enabled: CTCSSSupressEnabled }
                        ] as { option, icon, enabled }}
                          <button
                            class="retro-button text-white font-bold h-10 text-sm rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {enabled ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                            on:click={() => {
                              if (option === 'NR') handleNRChange();
                              else if (option === 'NB') handleNBChange();
                              else if (option === 'AN') handleANChange();
                              else handleCTCSSChange();
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              {#if icon === 'wave-square'}
                                <path d="M0 15h3v-3h3v3h3v-3h3v3h3v-3h3v3h3v-3h3" />
                              {:else if icon === 'zap'}
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                              {:else if icon === 'shield'}
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                              {:else if icon === 'filter'}
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                              {/if}
                            </svg>
                            <span>{option}</span>
                          </button>
                        {/each}
                      </div>
                    </div>
                  </div>
            
                  <hr class="border-gray-600 my-2">
            
                  <!-- Bandwidth -->
                  <div>
                    <h3 class="text-white text-lg font-semibold mb-2">Bandwidth</h3>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {#each bandwithoffsets as bandwidthoffset (bandwidthoffset)}
                        <button
                          class="retro-button text-white font-bold h-10 text-base rounded-md flex items-center justify-center border border-gray-600 shadow-inner transition-all duration-200 ease-in-out {bandwidth === bandwidthoffset ? 'bg-blue-600 pressed scale-95' : 'bg-gray-700 hover:bg-gray-600'}"
                          on:click={(e) => handleBandwidthOffsetClick(e, bandwidthoffset)}
                          title="{bandwidthoffset} kHz"
                        >
                          {bandwidthoffset}
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-col items-center bg-gray-800 p-6 lg:border lg:border-gray-700 rounded-none rounded-b-lg lg:rounded-none lg:rounded-r-lg">
              <h3 class="text-white text-lg font-semibold mb-4">Waterfall Controls</h3>
            
              <div class="w-full mb-6">

                <div id="brightness-controls" class="flex items-center justify-between mb-2">
                  <span class="text-gray-300 text-sm w-10">Min:</span>
                  <div class="slider-container w-48 mx-2">
                    <input
                      type="range"
                      bind:value={min_waterfall}
                      min="-100"
                      max="255"
                      step="1"
                      class="glass-slider w-full"
                      on:input={handleMinMove}
                    />
                  </div>
                  <span class="text-gray-300 text-sm w-10 text-right">{min_waterfall}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-gray-300 text-sm w-10">Max:</span>
                  <div class="slider-container w-48 mx-2">
                    <input
                      type="range"
                      bind:value={max_waterfall}
                      min="0"
                      max="255"
                      step="1"
                      class="glass-slider w-full"
                      on:input={handleMaxMove}
                    />
                  </div>
                  <span class="text-gray-300 text-sm w-10 text-right">{max_waterfall}</span>
                </div>
              </div>
            
              <div class="w-full mb-6">

                <div id="colormap-select" class="relative">
                  <select
                    bind:value={currentColormap}
                    on:change={handleWaterfallColormapSelect}
                    class="glass-select block w-full pl-3 pr-10 py-2 text-sm rounded-lg text-gray-200 appearance-none focus:outline-none"
                  >
                    {#each availableColormaps as colormap}
                      <option value={colormap}>{colormap}</option>
                    {/each}
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                    <svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </div>
                </div>
              </div>
            
              <div class="w-full mb-6">

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div id="auto-adjust" class="flex flex-col items-center">
                    <span class="text-sm text-gray-300 mb-1">Auto Adjust</span>
                    <label class="toggle-switch">
                      <input type="checkbox" bind:checked={autoAdjust} on:change={() => handleAutoAdjust(autoAdjust)}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div id="spectrum-toggle" class="flex flex-col items-center">
                    <span class="text-sm text-gray-300 mb-1">Spectrum</span>
                    <label class="toggle-switch">
                      <input type="checkbox" on:change={handleSpectrumChange}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  <div id="bigger-waterfall" class="flex flex-col items-center">
                    <span class="text-sm text-gray-300 mb-1 text-center">Increase Size</span>
                    <label class="toggle-switch">
                      <input type="checkbox" on:change={handleWaterfallSizeChange}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
              </div>
            
              <button
                id="bookmark-button"
                class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center w-full justify-center"
                on:click={toggleBookmarkPopup}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                </svg>
                Bookmarks
              </button>
            
              <div id="user_count_container" class="w-full mt-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg p-1">
                <div id="total_user_count" class="bg-gray-800 rounded-md p-2 text-center flex justify-between items-center">
                  <!-- Content will be populated by JavaScript -->
                </div>
              </div>
            

                <!-- Bookmark Popup -->
                {#if showBookmarkPopup}
                <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div class="bg-gray-800 p-6 rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                      <h2 class="text-xl font-bold text-white">Bookmarks</h2>
                      <button class="text-gray-400 hover:text-white" on:click={toggleBookmarkPopup}>
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                      </button>
                    </div>
              
                    <!-- Add Bookmark Section -->
                    <div class="mb-6">
                      <label class="block text-sm font-medium text-gray-300 mb-2">Add New Bookmark</label>
                      <div class="flex items-center gap-2">
                        <input
                          class="glass-input text-white text-sm rounded-lg focus:outline-none px-3 py-2 flex-grow"
                          bind:value={newBookmarkName}
                          placeholder="Bookmark name"
                        />
                        <button
                          class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center"
                          on:click={addBookmark}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 mr-2"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                              clip-rule="evenodd"
                            />
                          </svg>
                          Add
                        </button>
                      </div>
                    </div>
              
                    <!-- Current Link Section -->
                    <div class="mb-6">
                      <label class="block text-sm font-medium text-gray-300 mb-2">Current Link</label>
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          class="glass-input text-white text-sm rounded-lg focus:outline-none px-3 py-2 flex-grow"
                          value={link}
                          readonly
                        />
                        <button
                          class="glass-button text-white font-bold py-2 px-4 rounded-lg flex items-center"
                          on:click={handleLinkCopyClick}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 mr-2"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                          </svg>
                          Copy
                        </button>
                      </div>
                    </div>
              
                    <!-- Bookmarks List -->
                    <div class="overflow-y-auto flex-grow h-80">
                      <label class="block text-sm font-medium text-gray-300 mb-2">Saved Bookmarks</label>
                      {#each $bookmarks as bookmark, index}
                        <div class="glass-panel rounded-lg p-3 flex items-center justify-between mb-2">
                          <div class="flex flex-col">
                            <span class="text-white text-sm">{bookmark.name}</span>
                            <span class="text-gray-400 text-xs">{(bookmark.frequency / 1000).toFixed(3)} kHz</span>
                          </div>
                          <div class="flex gap-2">
                            <button
                              class="glass-button text-white font-bold py-1 px-3 rounded-lg flex items-center"
                              on:click={() => goToBookmark(bookmark)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 mr-1"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fill-rule="evenodd"
                                  d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                              Go
                            </button>
                            <button
                              class="glass-button text-white font-bold py-1 px-3 rounded-lg flex items-center"
                              on:click={() => copy(bookmark.link)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 mr-1"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                              </svg>
                              Copy
                            </button>
                            <button
                              class="glass-button text-white font-bold py-1 px-3 rounded-lg flex items-center"
                              on:click={() => deleteBookmark(index)}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 mr-1"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fill-rule="evenodd"
                                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                              Delete
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>
                </div>
              {/if}
             
        
              
            

              
            </div>
          </div>
          
          <div class="flex flex-col rounded p-2 justify-center " id="chat-column">
            <div class="p-3 sm:p-5 flex flex-col bg-gray-800 border border-gray-700 rounded-lg w-full mb-8" id="chat-box">
              <h2 class="text-xl sm:text-2xl font-semibold text-gray-100 mb-2 sm:mb-4">WebSDR Chatbox</h2>
         <p class="text-white text-xs sm:text-sm mr-2 mb-2 sm:mb-0">
                This chatbox is intended to discuss the operation of the WebSDR, so please keep the discussion civil and polite.<br /><br />
		</p>
              <!-- Username Display/Input -->
              <div class="mb-2 sm:mb-4 flex flex-wrap items-center">
                <span class="text-white text-xs sm:text-sm mr-2 mb-2 sm:mb-0">Chatting as:</span>
                {#if showUsernameInput}
                  <input
                    class="glass-input text-white py-1 px-2 rounded-lg outline-none text-xs sm:text-sm flex-grow mr-2 mb-2 sm:mb-0"
                    bind:value={username}
                    placeholder="Enter your name/callsign"
                    on:keydown={(e) => e.key === 'Enter' && saveUsername()}
                  />
                  <button
                    class="glass-button text-white py-1 px-3 mb-2 lg:mb-0 rounded-lg text-xs sm:text-sm"
                    on:click={saveUsername}
                  >
                    Save
                  </button>
                {:else}
                  <span class="glass-username text-white text-xs sm:text-sm px-3 py-1 rounded-lg mr-2 mb-2 sm:mb-0">
                    {username || 'Anonymous'}
                  </span>
                  <button
                    class="glass-button text-white py-1 px-3 mb-2 lg:mb-0 rounded-lg text-xs sm:text-sm"
                    on:click={editUsername}
                  >
                    Edit
                  </button>
                {/if}
              </div>
          
              <!-- Chat Messages -->
              <div class="bg-gray-900 rounded-lg p-2 sm:p-3 mb-2 sm:mb-4 h-48 sm:h-64 overflow-y-auto custom-scrollbar" bind:this={chatMessages}>
                {#each $messages as { id, text } (id)}
                  {@const formattedMessage = formatFrequencyMessage(text)}
                  <div class="mb-2 sm:mb-3 text-left" in:fly={{ y: 20, duration: 300, easing: quintOut }}>
                    <div class="inline-block bg-gray-800 rounded-lg p-2 max-w-full">
                      <p class="text-white text-xs sm:text-sm break-words">
                        <span class="font-semibold text-blue-300">{formattedMessage.username}</span>
                        <span class="text-xs text-gray-400 ml-2">{formattedMessage.timestamp}</span>
                      </p>
                      <p class="text-white text-xs sm:text-sm break-words mt-1">
                        {#if formattedMessage.isFormatted}
                          {@html renderParts(formattedMessage.beforeFreq)}
                          <a
                            href="#"
                            class="text-blue-300 hover:underline"
                            on:click|preventDefault={() => handleFrequencyClick(formattedMessage.frequency, formattedMessage.demodulation)}
                          >
                            {(formattedMessage.frequency / 1000).toFixed(3)} kHz ({formattedMessage.demodulation})
                          </a>
                          {@html renderParts(formattedMessage.afterFreq)}
                        {:else}
                          {@html renderParts(formattedMessage.parts)}
                        {/if}
                      </p>
                    </div>
                  </div>
                {/each}
              </div>
          
              <!-- Message Input and Buttons -->
              <div class="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                <input
                  class="glass-input text-white py-2 px-3 rounded-lg outline-none text-xs sm:text-sm flex-grow"
                  bind:value={newMessage}
                  on:keydown={handleEnterKey}
                  placeholder="Type a message..."
                />
                <div class="flex space-x-2">
                  <button
                    class="glass-button text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center text-xs sm:text-sm flex-grow sm:flex-grow-0"
                    on:click={sendMessage}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                    Send
                  </button>
                  <button
                    class="glass-button text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center text-xs sm:text-sm flex-grow sm:flex-grow-0"
                    on:click={pasteFrequency}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                    </svg>
                    Paste Freq
                  </button>
                </div>
  


          </div>
      </div>
        </div>
      </div>
  </div>
  <footer class="mt-4 mb-4 text-center text-gray-400 text-sm">
    <span class="text-sm text-gray-400">PhantomSDR+ | v{VERSION}</span>
  </footer>
</main>

<svelte:head>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
</svelte:head>

<style global lang="postcss">


  body {
    font-family: 'Inter', sans-serif;
    background-color: #f0f0f0;
    color: #333;
    line-height: 1.6;
    margin: 0;
    padding: 0;
  }

  .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }

        #hero {
            background-color: #2c3e50;
            color: #ecf0f1;
            padding: 100px 0;
            text-align: center;
        }

        

        #tagline {
            font-size: 2rem;
            margin-bottom: 2rem;
        }

        .btn {
            display: inline-block;
            padding: 12px 24px;
            background-color: #e74c3c;
            color: #fff;
            text-decoration: none;
            border-radius: 5px;
            font-weight: 700;
            transition: background-color 0.3s ease;
        }

        .btn:hover {
            background-color: #c0392b;
        }


  :root {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  }

  @media (min-width: 1372px) {
    #chat-box {
      min-width: var(--middle-column-width);
    }
    #chat-column
    {
      align-items: center;
    }
  }

  .full-screen-container {
    display: flex;
    flex-direction: row;
    height: 100vh;
  }

  .side-nav {
    flex-basis: 250px; 
    overflow-y: auto;
    background-color: #333;
    color: #fff;
  }

  .main-content {
    flex-grow: 1;
    overflow-y: auto;
    padding: 20px;
    max-width: 1372px; 
    margin: auto;
  }

  .tab-content {
    display: none; 
  }

  .tab-content.active {
    display: block; 
  }

  :global(body.light-mode) {
    background-color: #a9a9a9;
    transition: background-color 0.3s;
  }
  :global(body) {
    background-color: #212121;
  }

  main {
    text-align: center;
    margin: 0 auto;
  }
  .thick-line-through {
    text-decoration-thickness: 2px;
  }

  .basic-button {
    @apply text-blue-500 border border-blue-500 font-bold uppercase transition-all duration-100 text-center text-xs px-2 py-1
            peer-checked:bg-blue-600 peer-checked:text-white;
  }
  .basic-button:hover {
    @apply border-blue-400 text-white;
  }

  .click-button {
    @apply text-blue-500 border border-blue-500 font-bold uppercase transition-all duration-100 text-center text-xs px-2 py-1;
  }
  .click-button:active {
    @apply bg-blue-600 text-white;
  }


  .custom-scrollbar::-webkit-scrollbar {
    width: 12px;
    background-color: transparent;
  }

  .custom-scrollbar::-webkit-scrollbar-track {
    background-color: rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    margin: 5px 0;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    border: 3px solid rgba(0, 0, 0, 0.2);
    background-clip: padding-box;
  }

  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.3);
  }


  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05);
  }


  .scrollbar-container {
    padding-right: 12px;
    box-sizing: content-box;
  }

 /* Here you can Change the Background of WebSDR, Picture must be in assets folder*/
  .bg-custom-dark {
    /* background-color: #1c1c1c; /* Original: A very dark gray with a tiny hint of warmth */
    background: url("./assets/IMG_3689.jpg") no-repeat center center fixed;
    background-size: cover;
  }


  .glass-username {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    display: inline-block;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glass-button {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }

  .glass-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .glass-slider {
    -webkit-appearance: none;
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    border-radius: 3px;
  }

  .glass-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    background: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    border-radius: 50%;
  }

  #sMeter {
    width: 300px;
    height: 40px;
    background-color: transparent;
    display: block;
    margin-left: 30px;
    margin-top: 5px;
  }

  .smeter-container {
    background-color: black;
    padding: 10px;
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 310px;
    padding: 15px;
    background: #111;
    border-radius: 5px;
    position: relative;
    margin: 0 auto;
    box-shadow: 0 0 10px rgb(83 83 83 / 30%);
    font-family: "VT323", monospace;
  }

  .glass-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    border-radius: 50%;
  }

  .glass-message {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: background-color 0.3s;
  }

  .glass-message:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .glass-panel {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    transition: all 0.3s ease;
  }

  .glass-panel:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(-5px);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
  }

  .glass-input {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .control-group {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    max-width: 400px;
    
  }

  .slider-container {
    flex-grow: 1;
    margin: 0 15px;
    width: 200px;
  }

  .value-display {
    width: 50px;
    text-align: right;
  }

  .glass-button.active {
    background: linear-gradient(
      135deg,
      rgba(50, 50, 80, 0.8),
      rgba(60, 50, 80, 0.8)
    );
    border-color: rgba(120, 100, 180, 0.4);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.2),
      inset 0 1px 2px rgba(150, 130, 200, 0.1);
  }

  .glass-select {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }

  .glass-select:focus {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(99, 102, 241, 0.5);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
  }

  .glass-select option {
    background-color: #2a2c3e;
  }

  .glass-toggle-button {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
    min-width: 48px;
  }

  .glass-toggle-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .glass-toggle-button.active {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
  }

  .slide-transition {
    transition: max-height 300ms cubic-bezier(0.23, 1, 0.32, 1);
    overflow: hidden;
  }

  .chat-input {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: white !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important;
  }

  .chat-input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .chat-button {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: white !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important;
    font-size: 14px;
  }

  @supports (-webkit-touch-callout: none) {
    .chat-input,
    .chat-button {
      background-color: rgba(255, 255, 255, 0.1) !important;
      color: white !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
    }
  }



  .toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px; 
  height: 22px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #676767;
  transition: .4s;
  border-radius: 22px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;  
  left: 2px;   
  bottom: 2px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: #2196F3;
}

input:focus + .toggle-slider {
  box-shadow: 0 0 1px #2196F3;
}

input:checked + .toggle-slider:before {
  transform: translateX(18px);
}



@media screen and (min-width: 1372px) {
  #outer-waterfall-container {
    min-width: 1372px;
  }
}

</style>
