<svelte:options accessors/>

<script>
  import { audio } from '../lib/backend.js';
  import { RollingMax } from 'efficient-rolling-stats';
  import { createEventDispatcher } from 'svelte';
  import { eventBus } from '../eventBus';
  
  const dispatch = createEventDispatcher();
  
  // Props
  export let currentFrequency = 0;
  
  // Local state
  export let mute = false;
  let volume = 65;
  let squelchEnable = false;
  let squelch = -50;
  let power = 0;
  let powerPeak = 0;
  export let NREnabled = false;
  export let NBEnabled = false;
  export let ANEnabled = false;
  export let CTCSSSupressEnabled = false;
  let ft8Enabled = false;
  let isRecording = false;
  let canDownload = false;
  
  const numberOfDots = 35;
  const s9Index = 17;
  const accumulator = RollingMax(10);
  
  // Drawing S-meter
  function drawSMeter(value) {
    const canvas = document.getElementById("sMeter");
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
    
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

    ctx.strokeStyle = "#0071e3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(s9Position, lineY);
    ctx.stroke();

    ctx.strokeStyle = "#ff3b30";
    ctx.beginPath();
    ctx.moveTo(s9Position, lineY);
    ctx.lineTo(268, lineY);
    ctx.stroke();

    for (let i = 0; i < 30; i++) {
      const x = i * (segmentWidth + segmentGap);
      if (i < value) {
        ctx.fillStyle = i < 17 ? "#0071e3" : "#ff3b30";
      } else {
        ctx.fillStyle = i < 17 ? "rgba(0, 113, 227, 0.2)" : "rgba(255, 59, 48, 0.2)";
      }
      ctx.fillRect(x, 0, segmentWidth, segmentHeight);
    }

    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";

    const labels = ["S1", "3", "5", "7", "9", "+20", "+40", "+60dB"];

    for (let i = 0; i <= 16; i++) {
      const x = i * 16.6970588235;
      ctx.fillStyle = x <= s9Position ? "#0071e3" : "#ff3b30";

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
  
  function setSignalStrength(db) {
    db = Math.min(Math.max(db, -100), 0);
    const activeSegments = Math.round(((db + 100) * numberOfDots) / 100);
    drawSMeter(activeSegments);
  }
  
  // Audio control handlers
  export function handleMuteChange() {
    mute = !mute;
    audio.setMute(mute);
    dispatch('stateChange', { mute, NREnabled, NBEnabled, ANEnabled, CTCSSSupressEnabled });
    // Emit mute state change for mobile menu
    eventBus.publish('muteStateChanged', mute);
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
  
  export function handleNRChange() {
    NREnabled = !NREnabled;
    audio.decoder.set_nr(NREnabled);
    dispatch('stateChange', { mute, NREnabled, NBEnabled, ANEnabled, CTCSSSupressEnabled });
  }
  
  export function handleNBChange() {
    NBEnabled = !NBEnabled;
    audio.nb = NBEnabled;
    audio.decoder.set_nb(NBEnabled);
    dispatch('stateChange', { mute, NREnabled, NBEnabled, ANEnabled, CTCSSSupressEnabled });
  }
  
  export function handleANChange() {
    ANEnabled = !ANEnabled;
    audio.decoder.set_an(ANEnabled);
    dispatch('stateChange', { mute, NREnabled, NBEnabled, ANEnabled, CTCSSSupressEnabled });
  }
  
  export function handleCTCSSChange() {
    CTCSSSupressEnabled = !CTCSSSupressEnabled;
    audio.setCTCSSFilter(CTCSSSupressEnabled);
    dispatch('stateChange', { mute, NREnabled, NBEnabled, ANEnabled, CTCSSSupressEnabled });
  }
  
  function handleFt8Decoder(value) {
    ft8Enabled = value;
    audio.setFT8Decoding(value);
  }
  
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
  
  
  // Update signal meter periodically
  export function updateSignalMeter() {
    power = (audio.getPowerDb() / 150) * 100 + audio.smeter_offset;
    powerPeak = (accumulator(power) / 150) * 100 + audio.smeter_offset;
    setSignalStrength(power);
  }
  
  // Initialize audio settings
  export function initializeAudio() {
    handleVolumeChange();
  }
  
  // FT8 message animation handler
  function addFT8Message(message) {
    const messagesList = document.getElementById('ft8MessagesList');
    if (!messagesList) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'ft8-message ft8-message-new';
    messageDiv.textContent = message;
    
    // Insert at the top of the list
    messagesList.insertBefore(messageDiv, messagesList.firstChild);
    
    // Remove the 'new' styling after animation
    setTimeout(() => {
      messageDiv.classList.remove('ft8-message-new');
      messageDiv.classList.add('ft8-message-normal');
    }, 3000);
    
    // Limit messages to prevent overflow
    const messages = messagesList.children;
    if (messages.length > 20) {
      messagesList.removeChild(messages[messages.length - 1]);
    }
  }
  
  // Update farthest distance display
  function updateFarthestDistance(distance) {
    const element = document.getElementById('farthest-distance');
    if (element) {
      element.textContent = `${distance} km`;
    }
  }
</script>

<div class="audio-controls">
  <h2 class="section-title">Audio Controls</h2>
  
  <!-- Volume Control -->
  <div class="control-group" id="volume-slider">
    <div class="control-header">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="control-icon">
        <path d="M9 2.5v11a.5.5 0 01-.85.35L5.6 11.5H3a1 1 0 01-1-1v-5a1 1 0 011-1h2.6l2.55-2.35A.5.5 0 019 2.5z" fill="currentColor"/>
        <path d="M11.5 4.5a4 4 0 010 7M13 3a6 6 0 010 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span class="control-label">Volume</span>
      <span class="control-value">{volume}%</span>
    </div>
    <div class="slider-container">
      <button
        class="mute-button {mute ? 'active' : ''}"
        on:click={handleMuteChange}
        aria-label={mute ? 'Unmute' : 'Mute'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          {#if mute}
            <path d="M9 2.5v11a.5.5 0 01-.85.35L5.6 11.5H3a1 1 0 01-1-1v-5a1 1 0 011-1h2.6l2.55-2.35A.5.5 0 019 2.5z" fill="currentColor"/>
            <path d="M11 6l4 4m0-4l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          {:else}
            <path d="M9 2.5v11a.5.5 0 01-.85.35L5.6 11.5H3a1 1 0 01-1-1v-5a1 1 0 011-1h2.6l2.55-2.35A.5.5 0 019 2.5z" fill="currentColor"/>
            <path d="M11.5 4.5a4 4 0 010 7M13 3a6 6 0 010 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          {/if}
        </svg>
      </button>
      <div class="slider-wrapper">
        <input
          type="range"
          bind:value={volume}
          on:input={handleVolumeChange}
          disabled={mute}
          min="0"
          max="100"
          step="1"
          class="slider volume-slider"
        />
        <div class="slider-track" style="width: {volume}%"></div>
      </div>
    </div>
  </div>

  <!-- Squelch Control -->
  <div class="control-group" id="squelch-slider">
    <div class="control-header">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="control-icon">
        <path d="M8 1a7 7 0 110 14A7 7 0 018 1zM8 5a3 3 0 110 6 3 3 0 010-6z" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
      </svg>
      <span class="control-label">Squelch</span>
      <span class="control-value">{squelch} dB</span>
    </div>
    <div class="slider-container">
      <button
        class="squelch-button {squelchEnable ? 'active' : ''}"
        on:click={handleSquelchChange}
        aria-label={squelchEnable ? 'Disable squelch' : 'Enable squelch'}
      >
        <span>SQ</span>
      </button>
      <div class="slider-wrapper">
        <input
          type="range"
          bind:value={squelch}
          on:input={handleSquelchMove}
          min="-150"
          max="0"
          step="1"
          class="slider squelch-slider"
        />
        <div class="slider-track green" style="width: {((squelch + 150) / 150) * 100}%"></div>
      </div>
    </div>
  </div>

  <!-- Decoder Options -->
  <div class="decoder-section">
    <label class="section-label">Decoder Mode</label>
    <div class="decoder-buttons">
      <button
        class="decoder-button {!ft8Enabled ? 'active' : ''}"
        on:click={() => handleFt8Decoder(false)}
      >
        None
      </button>
      <button
        id="ft8-decoder"
        class="decoder-button {ft8Enabled ? 'active' : ''}"
        on:click={() => handleFt8Decoder(true)}
      >
        FT8
      </button>
    </div>
  </div>

  <!-- FT8 Messages List -->
  {#if ft8Enabled}
    <div class="ft8-container">
      <div class="ft8-header">
        <div class="accent-dot bg-purple"></div>
        <h4 class="ft8-title">FT8 Messages</h4>
        <span class="distance-badge" id="farthest-distance">0 km</span>
      </div>
      <div class="ft8-messages-wrapper">
        <div class="fade-overlay left"></div>
        <div class="fade-overlay right"></div>
        <div class="ft8-messages-scroll">
          <div id="ft8MessagesList" class="ft8-messages-list">
            <!-- Messages will be populated here -->
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Recording Options -->
  <div class="recording-section">
    <label class="section-label">Recording</label>
    <div class="recording-buttons">
      <button
        class="recording-button {isRecording ? 'recording' : ''}"
        on:click={toggleRecording}
      >
        {#if isRecording}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor"/>
          </svg>
          Stop
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="6" fill="currentColor"/>
          </svg>
          Record
        {/if}
      </button>
      
      {#if canDownload}
        <button
          class="recording-button download"
          on:click={downloadRecording}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 2v8m0 0l3-3m-3 3L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 14h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          Download
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Container */
  .audio-controls {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem 0 0 0.75rem;
  }
  
  @media (max-width: 1024px) {
    .audio-controls {
      border-radius: 0.75rem 0.75rem 0 0;
    }
  }
  
  /* Typography */
  .section-title {
    font-size: 1.375rem;
    font-weight: 600;
    color: #f5f5f7;
    margin-bottom: 2rem;
    letter-spacing: -0.01em;
  }
  
  .section-label {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
    margin-bottom: 0.75rem;
  }
  
  /* Control Groups */
  .control-group {
    width: 100%;
    min-width: 280px;
    max-width: 400px;
    margin-bottom: 1rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  @media (min-width: 640px) {
    .control-group {
      min-width: 370px;
    }
  }
  
  .control-header {
    display: flex;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  
  .control-icon {
    width: 16px;
    height: 16px;
    color: #a1a1a6;
    margin-right: 0.5rem;
  }
  
  .control-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #e5e5e7;
    flex: 1;
  }
  
  .control-value {
    font-size: 0.8125rem;
    font-family: 'SF Mono', monospace;
    color: #a1a1a6;
  }
  
  /* Slider Container */
  .slider-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  
  /* Buttons */
  .mute-button,
  .squelch-button {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1a6;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  
  @media (min-width: 640px) {
    .mute-button,
    .squelch-button {
      width: 2.5rem;
      height: 2.5rem;
    }
  }
  
  .mute-button:hover,
  .squelch-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: #e5e5e7;
  }
  
  .mute-button.active {
    background: rgba(255, 59, 48, 0.1);
    border-color: rgba(255, 59, 48, 0.2);
    color: #ff3b30;
  }
  
  .squelch-button.active {
    background: rgba(50, 215, 75, 0.1);
    border-color: rgba(50, 215, 75, 0.2);
    color: #32d74b;
  }
  
  .squelch-button span {
    font-size: 0.75rem;
    font-weight: 600;
  }
  
  /* Sliders */
  .slider-wrapper {
    position: relative;
    flex: 1;
    height: 2rem;
    display: flex;
    align-items: center;
  }
  
  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    border-radius: 4px;
    position: relative;
    z-index: 2;
  }
  
  .slider-track {
    position: absolute;
    height: 8px;
    background: #0071e3;
    border-radius: 4px;
    pointer-events: none;
    transition: width 0.1s ease;
  }
  
  .slider-track.green {
    background: #32d74b;
  }
  
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #f5f5f7;
    cursor: pointer;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }
  
  .slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #f5f5f7;
    cursor: pointer;
    border-radius: 50%;
    border: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transition: all 0.15s ease;
  }
  
  .slider:hover::-webkit-slider-thumb {
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  
  .slider:hover::-moz-range-thumb {
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  
  .slider:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .slider:disabled::-webkit-slider-thumb,
  .slider:disabled::-moz-range-thumb {
    background: #6e6e73;
    cursor: not-allowed;
  }
  
  /* Decoder Section */
  .decoder-section {
    width: 100%;
    margin-bottom: 1.5rem;
  }
  
  .decoder-buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  
  .decoder-button {
    padding: 0.75rem 1rem;
    border-radius: 0.625rem;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #a1a1a6;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .decoder-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: #e5e5e7;
    transform: scale(1.02);
  }
  
  .decoder-button.active {
    background: #0071e3;
    color: white;
    border-color: #0071e3;
  }
  
  .decoder-button.active:hover {
    background: #0077ed;
    border-color: #0077ed;
  }
  
  /* FT8 Container */
  .ft8-container {
    width: 100%;
    margin-bottom: 1.5rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    animation: fadeIn 0.3s ease-out;
  }
  
  .ft8-header {
    display: flex;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  
  .accent-dot {
    width: 3px;
    height: 14px;
    border-radius: 1.5px;
    margin-right: 0.5rem;
  }
  
  .bg-purple {
    background: #af52de;
  }
  
  .ft8-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
    flex: 1;
  }
  
  .distance-badge {
    font-size: 0.75rem;
    font-family: 'SF Mono', monospace;
    color: #af52de;
    background: rgba(175, 82, 222, 0.1);
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
  }
  
  .ft8-messages-wrapper {
    position: relative;
  }
  
  .fade-overlay {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2rem;
    pointer-events: none;
    z-index: 10;
  }
  
  .fade-overlay.left {
    left: 0;
    background: linear-gradient(to right, rgba(28, 28, 30, 0.4), transparent);
  }
  
  .fade-overlay.right {
    right: 0;
    background: linear-gradient(to left, rgba(28, 28, 30, 0.4), transparent);
  }
  
  .ft8-messages-scroll {
    overflow: auto;
    max-height: 8rem;
  }
  
  @media (min-width: 640px) {
    .ft8-messages-scroll {
      max-height: 10rem;
    }
  }
  
  .ft8-messages-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  
  :global(.ft8-message) {
    font-size: 0.75rem;
    font-family: 'SF Mono', monospace;
    padding: 0.375rem 0.75rem;
    border-radius: 0.5rem;
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }
  
  :global(.ft8-message:hover) {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(175, 82, 222, 0.3);
  }
  
  :global(.ft8-message-new) {
    background: rgba(175, 82, 222, 0.1);
    border-color: rgba(175, 82, 222, 0.3);
    color: #af52de;
    animation: slideIn 0.3s ease-out;
  }
  
  :global(.ft8-message-normal) {
    color: #a1a1a6;
  }
  
  /* Recording Section */
  .recording-section {
    width: 100%;
  }
  
  .recording-buttons {
    display: flex;
    gap: 0.75rem;
  }
  
  .recording-button {
    flex: 1;
    padding: 0.75rem 1rem;
    border-radius: 0.625rem;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  
  .recording-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    transform: scale(1.02);
  }
  
  .recording-button.recording {
    background: rgba(255, 59, 48, 0.1);
    border-color: rgba(255, 59, 48, 0.2);
    color: #ff3b30;
    animation: pulse 2s ease-in-out infinite;
  }
  
  .recording-button.recording:hover {
    background: rgba(255, 59, 48, 0.15);
    border-color: rgba(255, 59, 48, 0.3);
  }
  
  .recording-button.download {
    background: rgba(50, 215, 75, 0.1);
    border-color: rgba(50, 215, 75, 0.2);
    color: #32d74b;
  }
  
  .recording-button.download:hover {
    background: rgba(50, 215, 75, 0.15);
    border-color: rgba(50, 215, 75, 0.3);
  }
  
  /* Animations */
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }
  
  /* Scrollbar */
  .ft8-messages-scroll::-webkit-scrollbar {
    width: 6px;
  }
  
  .ft8-messages-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .ft8-messages-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  
  .ft8-messages-scroll:hover::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
  }
</style>