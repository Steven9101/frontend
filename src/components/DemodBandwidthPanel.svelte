<script>
  import { audio } from '../lib/backend.js';
  import { FFTOffsetToFrequency, frequencyToFFTOffset, getMaximumBandwidth } from '../lib/backend.js';
  import { eventBus } from '../eventBus';
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  
  const dispatch = createEventDispatcher();
  
  // Props
  export let frequencyInputComponent;
  export let passbandTunerComponent;
  export let demodulation = "USB";
  
  // Local state
  let bandwidth = "2.8";
  let demodulators = ["USB", "LSB", "CW", "AM", "FM"];
  let bandwithoffsets = ["-1000", "-100", "100", "1000"];
  let fineTuningSteps = ["-10", "-1", "-0.1", "0", "+0.1", "+1", "+10"];
  let currentAmMode = "AM"; // Track current AM mode (AM or SAM)
  let showAmMenu = false;
  let holdTimeout;
  let isHolding = false;
  
  const demodulationDefaults = {
    USB: { type: "USB", offsets: [-100, 2800] },
    LSB: { type: "LSB", offsets: [2800, -100] },
    "CW": { type: "USB", offsets: [250, 250] },
    AM: { type: "AM", offsets: [5000, 5000] },
    SAM: { type: "SAM", offsets: [5000, 5000] },
    FM: { type: "FM", offsets: [5000, 5000] },
    WBFM: { type: "FM", offsets: [95000, 95000] },
  };
  
  export function SetMode(mode) {
    if (mode == "CW-U" || mode == "CW-L") {
      mode = "CW";
    }
    // Dispatch event to parent to update demodulation state
    dispatch('modeChange', mode);
    // Also publish to eventBus for other listeners
    eventBus.publish('setMode', mode);
  }

  function handleAmMouseDown() {
    isHolding = true;
    holdTimeout = setTimeout(() => {
      if (isHolding) {
        showAmMenu = true;
      }
    }, 500); // 500ms hold time
  }

  function handleAmMouseUp() {
    if (holdTimeout) {
      clearTimeout(holdTimeout);
    }
    
    if (!isHolding) return;
    
    if (!showAmMenu) {
      // Quick click - select current mode
      SetMode(currentAmMode);
    }
    
    isHolding = false;
  }

  function handleAmMouseLeave() {
    if (holdTimeout) {
      clearTimeout(holdTimeout);
    }
    isHolding = false;
  }

  function selectAmMode(mode) {
    currentAmMode = mode;
    localStorage.setItem('amMode', mode);
    SetMode(mode);
    showAmMenu = false;
  }

  function closeAmMenu() {
    showAmMenu = false;
  }

  // Load AM mode preference from localStorage
  function loadAmPreference() {
    const savedMode = localStorage.getItem('amMode');
    if (savedMode === 'SAM' || savedMode === 'AM') {
      currentAmMode = savedMode;
    }
  }
  
  export function handleDemodulationChange(e, changed) {
    if (passbandTunerComponent) {
      passbandTunerComponent.setMode(demodulation);
    }
    const demodulationDefault = demodulationDefaults[demodulation];
    
    if (changed) {
      if (demodulation === "WBFM") {
        audio.setFmDeemph(50e-6);
      } else {
        audio.setFmDeemph(0);
      }
      if (demodulationDefault.type == "USB" && demodulationDefault.offsets[0] == 250) {
        audio.setAudioDemodulation("CW");
      } else {
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

    const frequency = frequencyInputComponent.getFrequency();

    // CW offset handling
    const lOffset = l - 200;
    const mOffset = m - 750;
    const rOffset = r - 200;
    const audioParametersOffset = [lOffset, mOffset, rOffset].map(frequencyToFFTOffset);
    const audioParameters = [l, m, r].map(frequencyToFFTOffset);

    // Set audio range with both normal and offset values
    audio.setAudioRange(...audioParameters, ...audioParametersOffset);
    
    updatePassband();
    updateLink();
    eventBus.publish('demodulationChange', { demodulation, frequency });
  }
  
  function handleBandwidthOffsetClick(e, bandwidthoffset) {
    bandwidthoffset = parseFloat(bandwidthoffset);
    const demodulationDefault = demodulationDefaults[demodulation].type;
    let [l, m, r] = audio.getAudioRange().map(FFTOffsetToFrequency);
    
    if (demodulationDefault === "USB") {
      r = Math.max(m, Math.min(m + getMaximumBandwidth(), r + bandwidthoffset));
    } else if (demodulationDefault === "LSB") {
      l = Math.max(m - getMaximumBandwidth(), Math.min(m, l - bandwidthoffset));
    } else {
      r = Math.max(0, Math.min(m + getMaximumBandwidth() / 2, r + bandwidthoffset / 2));
      l = Math.max(m - getMaximumBandwidth() / 2, Math.min(m, l - bandwidthoffset / 2));
    }
    
    let audioParameters = [l, m, r].map(frequencyToFFTOffset);
    const lOffset = l - 200;
    const mOffset = m - 750;
    const rOffset = r - 200;
    const audioParametersOffset = [lOffset, mOffset, rOffset].map(frequencyToFFTOffset);

    audio.setAudioRange(...audioParameters, ...audioParametersOffset);
    updatePassband();
  }
  
  function handleFineTuningClick(step) {
    const currentFreq = frequencyInputComponent.getFrequency();
    let newFreq;
    
    if (step === "0") {
      // Round to nearest 1 kHz (remove Hz portion)
      // e.g., 11519726 Hz → 11520000 Hz (11520 kHz)
      newFreq = Math.round(currentFreq / 1000) * 1000;
      console.log('Zero button: Current freq:', currentFreq, 'Hz, Rounding to:', newFreq, 'Hz');
    } else {
      // Normal fine tuning step
      const stepKHz = parseFloat(step);
      const stepHz = stepKHz * 1000; // Convert kHz to Hz
      newFreq = currentFreq + stepHz;
    }
    
    frequencyInputComponent.setFrequency(newFreq);
    eventBus.publish('frequencyChange', { detail: newFreq });
  }
  
  function updatePassband() {
    const passband = audio.getAudioRange();
    const frequencies = passband.map(FFTOffsetToFrequency);
    bandwidth = ((frequencies[2] - frequencies[0]) / 1000).toFixed(2);
    
    // Publish passbandChange event to update the bandwidth text in App.svelte
    const offsets = [
      frequencies[0] - 200,
      frequencies[1] - 750,
      frequencies[2] - 200
    ];
    eventBus.publish('passbandChange', { frequencies, offsets });
    eventBus.publish('passbandUpdate', passband);
  }
  
  function updateLink() {
    eventBus.publish('linkUpdate');
  }
  
  // Initialize on mount
  export function initialize() {
    if (audio.trueAudioSps > 170000) {
      demodulators.push("WBFM");
      demodulators = demodulators;
      bandwithoffsets.unshift("-100000");
      bandwithoffsets.push("100000");
      bandwithoffsets = bandwithoffsets;
    }
  }

  // Handle clicks outside AM menu
  function handleDocumentClick(event) {
    if (showAmMenu && !event.target.closest('.am-button-container')) {
      showAmMenu = false;
    }
  }

  // Lifecycle
  onMount(() => {
    loadAmPreference();
    
    // Update currentAmMode when demodulation changes externally
    if (demodulation === 'AM' || demodulation === 'SAM') {
      currentAmMode = demodulation;
    }
    
    // Add click outside handler
    document.addEventListener('click', handleDocumentClick);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleDocumentClick);
    if (holdTimeout) {
      clearTimeout(holdTimeout);
    }
  });

  // Reactive statement to sync currentAmMode with demodulation
  $: if (demodulation === 'AM' || demodulation === 'SAM') {
    currentAmMode = demodulation;
  }
</script>

<div class="frequency-controls">
  <div id="frequencyContainer" class="controls-container">
    <!-- Fine Tuning -->
    <div class="control-section">
      <div class="section-header">
        <div class="accent-dot bg-orange"></div>
        <h3 class="section-label">Fine Tuning</h3>
      </div>
      <div class="fine-tuning-grid">
        {#each fineTuningSteps as step}
          <button
            class="fine-tuning-button"
            on:click={() => handleFineTuningClick(step)}
            title="{step} kHz"
          >
            {step}
          </button>
        {/each}
      </div>
    </div>
    
    <!-- Demodulation -->
    <div class="control-section">
      <div class="section-header">
        <div class="accent-dot bg-blue"></div>
        <h3 class="section-label">Modulation</h3>
      </div>
      <div id="demodulationModes" class="mode-grid">
        {#each ['USB', 'LSB', 'CW'] as mode}
          <button
            on:click={() => SetMode(mode)}
            class="mode-button {demodulation === mode ? 'active' : ''}"
          >
            {mode}
          </button>
        {/each}
        
        <!-- AM Button with Hold Menu -->
        <div class="am-button-container">
          <button
            on:mousedown={handleAmMouseDown}
            on:mouseup={handleAmMouseUp}
            on:mouseleave={handleAmMouseLeave}
            on:touchstart={handleAmMouseDown}
            on:touchend={handleAmMouseUp}
            class="mode-button am-button {demodulation === 'AM' || demodulation === 'SAM' ? 'active' : ''} {isHolding ? 'holding' : ''}"
            title="Click to select {currentAmMode} • Hold to choose AM/SAM"
          >
            <span class="am-button-text">{currentAmMode}</span>
            <!-- Hold indicator -->
            <div class="am-hold-indicator">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="2" height="2" rx="0.5" fill="currentColor" opacity="0.6"/>
                <rect x="6" y="2" width="2" height="2" rx="0.5" fill="currentColor" opacity="0.6"/>
                <rect x="2" y="6" width="2" height="2" rx="0.5" fill="currentColor" opacity="0.6"/>
                <rect x="6" y="6" width="2" height="2" rx="0.5" fill="currentColor" opacity="0.6"/>
              </svg>
            </div>
          </button>
          
          <!-- Hold Menu -->
          {#if showAmMenu}
            <div class="am-hold-menu" on:click|stopPropagation>
              <div class="am-menu-item" on:click={() => selectAmMode('AM')}>
                <span class="am-menu-label">AM</span>
                <span class="am-menu-desc">Envelope Detection</span>
              </div>
              <div class="am-menu-item" on:click={() => selectAmMode('SAM')}>
                <span class="am-menu-label">SAM</span>
                <span class="am-menu-desc">Synchronous</span>
              </div>
            </div>
          {/if}
        </div>
        
        <button
          on:click={() => SetMode('FM')}
          class="mode-button {demodulation === 'FM' ? 'active' : ''}"
        >
          FM
        </button>
      </div>
    </div>
    
    <!-- Bandwidth -->
    <div class="control-section">
      <div class="section-header">
        <div class="accent-dot bg-green"></div>
        <h3 class="section-label">Bandwidth</h3>
      </div>
      <div class="bandwidth-grid">
        {#each bandwithoffsets as bandwidthoffset (bandwidthoffset)}
          <button
            class="bandwidth-button"
            on:click={(e) => handleBandwidthOffsetClick(e, bandwidthoffset)}
            title="{bandwidthoffset} Hz"
          >
            {parseFloat(bandwidthoffset) > 0 ? '+' : ''}{bandwidthoffset}
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* Container */
  .frequency-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: #1c1c1e;
    padding: 0.5rem 0 0.75rem;
    width: 100%;
  }
  
  .controls-container {
    width: 100%;
  }
  
  /* Control Sections */
  .control-section {
    width: 100%;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 0.75rem;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 0.75rem;
  }
  
  .control-section:last-child {
    margin-bottom: 0;
  }
  
  /* Section Header */
  .section-header {
    display: flex;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  
  .accent-dot {
    width: 3px;
    height: 14px;
    border-radius: 1.5px;
    margin-right: 0.5rem;
  }
  
  .bg-blue {
    background: #0071e3;
  }
  
  .bg-green {
    background: #32d74b;
  }
  
  .bg-orange {
    background: #ff9500;
  }
  
  .section-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
  }
  
  /* Mode Grid */
  .mode-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
  }
  
  .mode-button {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .mode-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    transform: scale(1.02);
  }
  
  .mode-button.active {
    background: #0071e3;
    color: white;
    border-color: #0071e3;
    box-shadow: 0 2px 8px rgba(0, 113, 227, 0.3);
  }
  
  .mode-button.active:hover {
    background: #0077ed;
    border-color: #0077ed;
  }

  /* AM Button with Hold Menu */
  .am-button-container {
    position: relative;
    display: inline-block;
  }

  .am-button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    transition: all 0.15s ease;
    width: 100%;
    /* Remove custom padding to inherit from .mode-button */
  }

  .am-button.holding {
    background: rgba(255, 255, 255, 0.1);
    transform: scale(0.95);
  }

  .am-button-text {
    position: relative;
    z-index: 1;
  }

  .am-hold-indicator {
    position: absolute;
    right: 2px;
    bottom: 2px;
    opacity: 0.4;
    pointer-events: none;
    z-index: 2;
  }

  .am-button:hover .am-hold-indicator {
    opacity: 0.7;
  }

  .am-hold-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background: rgba(30, 30, 32, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.5rem;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 10000;
    margin-bottom: 0.25rem;
    overflow: hidden;
    animation: menuAppear 0.15s ease-out;
  }

  @keyframes menuAppear {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .am-menu-item {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    cursor: pointer;
    transition: background 0.15s ease;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .am-menu-item:last-child {
    border-bottom: none;
  }

  .am-menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .am-menu-item:active {
    background: rgba(255, 255, 255, 0.12);
  }

  .am-menu-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
    margin-bottom: 0.125rem;
  }

  .am-menu-desc {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    font-weight: 400;
  }

  
  /* Bandwidth Grid */
  .bandwidth-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  
  .bandwidth-button {
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: 'SF Mono', monospace;
  }
  
  .bandwidth-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    transform: scale(1.02);
  }
  
  .bandwidth-button:active {
    background: rgba(255, 255, 255, 0.12);
    transform: scale(0.98);
  }
  
  /* Fine Tuning Grid */
  .fine-tuning-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.25rem;
  }
  
  .fine-tuning-button {
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    font-weight: 500;
    font-size: 0.75rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: 'SF Mono', monospace;
  }
  
  .fine-tuning-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    transform: scale(1.02);
  }
  
  .fine-tuning-button:active {
    background: rgba(255, 255, 255, 0.12);
    transform: scale(0.98);
  }

  /* Responsive adjustments for WBFM mode */
  @media (max-width: 640px) {
    .mode-grid {
      grid-template-columns: repeat(3, 1fr);
    }
    
    .bandwidth-grid {
      grid-template-columns: repeat(3, 1fr);
    }
    
    .fine-tuning-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>