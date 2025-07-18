<script>
  import { serverInfo } from '../stores/serverInfo.js';
  import { frequencySteps } from '../stores/frequencySteps.js';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { onMount, onDestroy } from 'svelte';
  import { audio } from '../lib/backend.js';
  
  export let currentFrequency = 0;
  
  let callsignInput = '';
  let showSettingsModal = false;
  let showKeybindsModal = false;
  let activeTab = 'general';
  let agcSpeed = 'default';
  let bufferSize = 'medium';
  let customAttack = 3.0;
  let customRelease = 250.0;
  
  // Frequency step settings - use store values
  $: ({ mouseWheelStep, keyboardStep, keyboardJumpStep } = $frequencySteps);
  
  // Dropdown states
  let showMouseWheelDropdown = false;
  let showKeyboardDropdown = false;
  let showJumpDropdown = false;
  
  // Audio stats
  let audioStats = {
    sampleRate: 0,
    powerDb: 0,
    squelchEnabled: false,
    squelchThreshold: 0,
    muted: false,
    gain: 0,
    demodulation: '',
    ctcssEnabled: false,
    audioDelay: 0
  };

  // Config management
  let configData = '';
  let configError = '';
  let configSuccess = '';
  
  // Signal history for graph
  let signalHistory = [];
  const MAX_HISTORY_POINTS = 50;
  let minDbRange = -60;
  let maxDbRange = 0;
  
  let statsInterval;
  
  function handleCallsignLookup(event) {
    event.preventDefault();
    if (callsignInput.trim() && $serverInfo?.callsignLookupUrl) {
      window.open($serverInfo.callsignLookupUrl + callsignInput.trim(), '_blank');
    }
  }
  
  function openSettings() {
    showSettingsModal = true;
    startStatsUpdate();
  }
  
  function closeSettings() {
    showSettingsModal = false;
    stopStatsUpdate();
  }
  
  function startStatsUpdate() {
    updateAudioStats();
    statsInterval = setInterval(updateAudioStats, 100);
  }
  
  function stopStatsUpdate() {
    if (statsInterval) {
      clearInterval(statsInterval);
    }
  }
  
  function updateAudioStats() {
    if (audio) {
      audioStats.sampleRate = audio.trueAudioSps || 0;
      audioStats.powerDb = audio.getPowerDb ? audio.getPowerDb() : 0;
      audioStats.squelchEnabled = audio.squelch || false;
      audioStats.squelchThreshold = audio.squelchThreshold || 0;
      audioStats.muted = audio.mute || false;
      audioStats.gain = audio.gain || 0;
      audioStats.demodulation = audio.demodulation || 'USB';
      audioStats.ctcssEnabled = audio.ctcss || false;
      audioStats.audioDelay = audio.getAudioDelay ? audio.getAudioDelay() : 0;
      
      // Update signal history
      signalHistory = [...signalHistory, audioStats.powerDb];
      if (signalHistory.length > MAX_HISTORY_POINTS) {
        signalHistory = signalHistory.slice(-MAX_HISTORY_POINTS);
      }
      
      // Dynamically adjust range if signal goes outside bounds
      if (audioStats.powerDb < minDbRange) {
        minDbRange = Math.floor(audioStats.powerDb / 10) * 10;
      }
      if (audioStats.powerDb > maxDbRange) {
        maxDbRange = Math.ceil(audioStats.powerDb / 10) * 10;
      }
    }
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape') {
      if (showSettingsModal) {
        closeSettings();
      }
      if (showKeybindsModal) {
        showKeybindsModal = false;
      }
    }
  }
  
  function toggleDropdown(dropdown) {
    // Check if the selected dropdown is already open
    const isCurrentlyOpen = 
      (dropdown === 'mouseWheel' && showMouseWheelDropdown) ||
      (dropdown === 'keyboard' && showKeyboardDropdown) ||
      (dropdown === 'jump' && showJumpDropdown);
    
    // Close all dropdowns first
    showMouseWheelDropdown = false;
    showKeyboardDropdown = false;
    showJumpDropdown = false;
    
    // If the dropdown wasn't open, open it
    if (!isCurrentlyOpen) {
      if (dropdown === 'mouseWheel') showMouseWheelDropdown = true;
      else if (dropdown === 'keyboard') showKeyboardDropdown = true;
      else if (dropdown === 'jump') showJumpDropdown = true;
    }
  }
  
  function handleClickOutside(event) {
    if (!event.target.closest('.dropdown-container')) {
      showMouseWheelDropdown = false;
      showKeyboardDropdown = false;
      showJumpDropdown = false;
    }
  }

  function exportConfig() {
    try {
      const config = {
        version: '1.0',
        settings: {
          agcSpeed,
          bufferSize,
          customAttack,
          customRelease,
          frequencySteps: $frequencySteps,
          amMode: localStorage.getItem('amMode') || 'AM'
        },
        timestamp: new Date().toISOString()
      };
      
      // Create and download file
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'phantom-sdr-config.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      configSuccess = 'Config exported successfully!';
      configError = '';
      
      // Auto-clear success message
      setTimeout(() => {
        configSuccess = '';
      }, 3000);
    } catch (error) {
      configError = 'Error exporting config: ' + error.message;
      configSuccess = '';
    }
  }

  function importConfig() {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          configError = '';
          configSuccess = '';
          
          const config = JSON.parse(e.target.result);
          
          if (!config.version || !config.settings) {
            configError = 'Invalid config format';
            return;
          }

          // Apply settings
          if (config.settings.agcSpeed) {
            agcSpeed = config.settings.agcSpeed;
            if (audio && audio.setAGCSpeed) {
              if (agcSpeed === 'custom') {
                audio.setAGCSpeed(agcSpeed, customAttack, customRelease);
              } else {
                audio.setAGCSpeed(agcSpeed);
              }
            }
          }
          
          if (config.settings.bufferSize) {
            bufferSize = config.settings.bufferSize;
            if (audio && audio.setBufferSize) {
              audio.setBufferSize(bufferSize);
            }
          }
          
          if (config.settings.customAttack) {
            customAttack = config.settings.customAttack;
          }
          
          if (config.settings.customRelease) {
            customRelease = config.settings.customRelease;
          }
          
          if (config.settings.frequencySteps) {
            frequencySteps.set(config.settings.frequencySteps);
          }
          
          if (config.settings.amMode) {
            localStorage.setItem('amMode', config.settings.amMode);
          }

          configSuccess = 'Config imported successfully!';
          
          // Auto-clear success message
          setTimeout(() => {
            configSuccess = '';
          }, 3000);
        } catch (error) {
          configError = 'Error importing config: ' + error.message;
          configSuccess = '';
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  
  onMount(() => {
    window.addEventListener('click', handleClickOutside);
  });
  
  onDestroy(() => {
    stopStatsUpdate();
    window.removeEventListener('click', handleClickOutside);
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="server-info-container">
  <div class="server-info-card">
    <!-- Settings and Keybinds buttons -->
    <div class="action-buttons">
      <!-- Keybinds button -->
      <button
        on:click={() => showKeybindsModal = true}
        class="icon-button"
        title="Keyboard Shortcuts"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <rect x="5" y="7" width="2" height="2" fill="currentColor"/>
          <rect x="9" y="7" width="2" height="2" fill="currentColor"/>
          <rect x="13" y="7" width="2" height="2" fill="currentColor"/>
          <rect x="5" y="11" width="2" height="2" fill="currentColor"/>
          <rect x="9" y="11" width="2" height="2" fill="currentColor"/>
          <rect x="13" y="11" width="2" height="2" fill="currentColor"/>
        </svg>
      </button>
      
      <!-- Settings button -->
      <button
        on:click={openSettings}
        class="icon-button"
        title="Settings"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11.078 1.82a1 1 0 00-2.156 0l-.123.556a7.92 7.92 0 00-.924.383l-.483-.289a1 1 0 00-1.54 1.26l.36.43a7.92 7.92 0 00-.531.863l-.559-.083a1 1 0 00-1.13 1.776l.436.355a7.92 7.92 0 00-.002 1.016l-.437.355a1 1 0 001.13 1.776l.56-.083c.139.301.312.585.516.847l-.345.412a1 1 0 001.54 1.26l.466-.279c.305.158.628.284.963.373l.122.551a1 1 0 002.156 0l.122-.551a7.92 7.92 0 00.963-.373l.466.279a1 1 0 001.54-1.26l-.345-.412c.204-.262.377-.546.516-.847l.56.083a1 1 0 001.13-1.776l-.437-.355a7.92 7.92 0 00-.002-1.016l.437-.355a1 1 0 00-1.13-1.776l-.56.083a7.92 7.92 0 00-.516-.847l.345-.412a1 1 0 00-1.54-1.26l-.466.279a7.92 7.92 0 00-.963-.373l-.122-.551z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    </div>
    
    <!-- Mobile Grid Locator -->
    <div class="mobile-location-badge">
      {$serverInfo.location}
    </div>
    
    <!-- Header -->
    <div class="header-section">
      <h1 class="server-name">
        {$serverInfo.serverName}
        <span class="location-badge desktop-only">
          {$serverInfo.location}
        </span>
      </h1>
      <div class="operator-info">
        Operated by
        {#each $serverInfo.operators as operator, i}
          <span class="operator-name">{operator.name}</span>{#if i < $serverInfo.operators.length - 1}{' & '}{/if}
        {/each}
      </div>
      <div class="email-wrapper">
        <a href="mailto:{$serverInfo.email}" class="email-link">
          {$serverInfo.email}
        </a>
      </div>
      <a
        href={$serverInfo.sdrListUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="network-button"
      >
        Visit PhantomSDR+ Network
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 1H2C1.44772 1 1 1.44772 1 2V12C1 12.5523 1.44772 13 2 13H12C12.5523 13 13 12.5523 13 12V9M9 1H13V5M13 1L7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
    </div>
    
    <!-- Lookup sections -->
    <div class="lookup-grid">
      <!-- Frequency Lookup -->
      <div class="lookup-section">
        <h3 class="section-title">Frequency Lookup</h3>
        <div class="lookup-links">
          {#each $serverInfo.frequencyLookup as lookup}
            <a
              href={lookup.url + (currentFrequency / 1000).toFixed(0)}
              target="_blank"
              rel="noopener noreferrer"
              class="lookup-link"
            >
              {lookup.name}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4.5 1H2C1.44772 1 1 1.44772 1 2V10C1 10.5523 1.44772 11 2 11H10C10.5523 11 11 10.5523 11 10V7.5M8 1H11V4M11 1L6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </a>
          {/each}
        </div>
      </div>
      
      <!-- Callsign Lookup -->
      <div class="lookup-section">
        <h3 class="section-title">Callsign Lookup</h3>
        <form on:submit={handleCallsignLookup} class="callsign-form">
          <input
            type="text"
            bind:value={callsignInput}
            placeholder="Enter callsign..."
            class="callsign-input"
          />
          <button
            type="submit"
            class="lookup-button"
            disabled={!callsignInput.trim()}
          >
            Lookup
          </button>
        </form>
      </div>
    </div>
  </div>
</div>

<!-- Settings Modal -->
{#if showSettingsModal}
  <div class="modal-container">
    <div
      class="modal-backdrop"
      on:click={closeSettings}
      transition:fade={{ duration: 150 }}
    ></div>
    
    <div
      class="modal-content settings-modal"
      transition:scale={{ duration: 200, easing: quintOut, start: 0.95 }}
    >
      <!-- Header -->
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button
          on:click={closeSettings}
          class="close-button"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      
      <!-- Tabs -->
      <div class="tab-bar">
        <button
          on:click={() => activeTab = 'general'}
          class="tab-button {activeTab === 'general' ? 'active' : ''}"
        >
          General
        </button>
        <button
          on:click={() => activeTab = 'debug'}
          class="tab-button {activeTab === 'debug' ? 'active' : ''}"
        >
          Debug
        </button>
        <button
          on:click={() => activeTab = 'config'}
          class="tab-button {activeTab === 'config' ? 'active' : ''}"
        >
          Config
        </button>
      </div>
      
      <!-- Content -->
      <div class="modal-body">
        {#if activeTab === 'debug'}
          <!-- Debug Tab -->
          <div class="debug-content">
            <h3 class="content-title">Audio Statistics</h3>
            
            <!-- Stats Grid -->
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-label">Sample Rate</div>
                <div class="stat-value text-blue-500">{(audioStats.sampleRate / 1000).toFixed(1)} kHz</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">Signal Power</div>
                <div class="stat-value {audioStats.powerDb > -20 ? 'text-green-500' : audioStats.powerDb > -40 ? 'text-yellow-500' : 'text-red-500'}">
                  {audioStats.powerDb ? audioStats.powerDb.toFixed(1) : '0.0'} dB
                </div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">Demodulation</div>
                <div class="stat-value text-blue-500">{audioStats.demodulation}</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">Audio Gain</div>
                <div class="stat-value text-purple-500">{(audioStats.gain * 35).toFixed(0)}</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">Squelch</div>
                <div class="stat-value {audioStats.squelchEnabled ? 'text-green-500' : 'text-gray-500'}">
                  {audioStats.squelchEnabled ? 'ON' : 'OFF'}
                  {#if audioStats.squelchEnabled}
                    <span class="stat-detail">({audioStats.squelchThreshold} dB)</span>
                  {/if}
                </div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">Mute</div>
                <div class="stat-value {audioStats.muted ? 'text-red-500' : 'text-gray-500'}">
                  {audioStats.muted ? 'MUTED' : 'ACTIVE'}
                </div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">CTCSS Filter</div>
                <div class="stat-value {audioStats.ctcssEnabled ? 'text-green-500' : 'text-gray-500'}">
                  {audioStats.ctcssEnabled ? 'ON' : 'OFF'}
                </div>
              </div>
              
              <div class="stat-card">
                <div class="stat-label">Audio Delay</div>
                <div class="stat-value {audioStats.audioDelay < 100 ? 'text-green-500' : audioStats.audioDelay < 200 ? 'text-yellow-500' : 'text-red-500'}">
                  {audioStats.audioDelay.toFixed(0)} ms
                </div>
              </div>
            </div>
            
            <!-- Signal History Graph -->
            <div class="graph-card">
              <div class="graph-label">Signal Strength History</div>
              <div class="graph-container">
                <svg class="graph-svg" viewBox="0 0 200 100" preserveAspectRatio="none">
                  {#if signalHistory.length > 1}
                    <polyline
                      fill="none"
                      stroke="#0071e3"
                      stroke-width="2"
                      points={signalHistory.map((db, i) => {
                        const x = (i / (MAX_HISTORY_POINTS - 1)) * 200;
                        const y = 100 - ((db - minDbRange) / (maxDbRange - minDbRange) * 100);
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                    
                    {#if signalHistory.length > 0}
                      {@const currentDb = signalHistory[signalHistory.length - 1]}
                      <circle
                        cx={(signalHistory.length - 1) / (MAX_HISTORY_POINTS - 1) * 200}
                        cy={100 - ((currentDb - minDbRange) / (maxDbRange - minDbRange) * 100)}
                        r="3"
                        fill="#0071e3"
                      />
                    {/if}
                  {/if}
                </svg>
                
                <!-- Y-axis labels -->
                <div class="graph-y-labels">
                  <span>{maxDbRange} dB</span>
                  <span>{minDbRange} dB</span>
                </div>
                
                <!-- X-axis labels -->
                <div class="graph-x-labels">
                  <span>5s ago</span>
                  <span>Now</span>
                </div>
              </div>
              
              <div class="current-value">
                Current: <span class="{audioStats.powerDb > -20 ? 'text-green-500' : audioStats.powerDb > -40 ? 'text-yellow-500' : 'text-red-500'}">
                  {audioStats.powerDb ? audioStats.powerDb.toFixed(1) : '0.0'} dB
                </span>
              </div>
            </div>
          </div>
        {:else if activeTab === 'config'}
          <!-- Config Tab -->
          <div class="config-content">
            <h3 class="content-title">Configuration Management</h3>
            
            <!-- Export/Import Actions -->
            <div class="config-actions">
              <button on:click={exportConfig} class="action-button export-button">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 1V11M8 1L5 4M8 1L11 4M2 11V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Export Config
              </button>
              
              <button on:click={importConfig} class="action-button import-button">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 15V5M8 15L5 12M8 15L11 12M2 5V3C2 2.44772 2.44772 2 3 2H13C13.5523 2 14 2.44772 14 3V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Import Config
              </button>
            </div>
            
            <!-- Status Messages -->
            {#if configSuccess}
              <div class="message success-message">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13 4L6 11L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {configSuccess}
              </div>
            {/if}
            
            {#if configError}
              <div class="message error-message">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 1C4.134 1 1 4.134 1 8s3.134 7 7 7 7-3.134 7-7-3.134-7-7-7zM8 11V8M8 5V5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {configError}
              </div>
            {/if}
            
            <!-- Config Description -->
            <div class="config-description">
              <p class="config-desc-text">
                Export your current settings to a file, or import settings from a previously saved configuration file.
              </p>
            </div>
          </div>
          
        {:else if activeTab === 'general'}
          <!-- General Tab -->
          <div class="general-content">
            <!-- AGC Speed Setting -->
            <div class="setting-card">
              <h4 class="setting-title">AGC Speed</h4>
              <div class="button-group">
                {#each ['slow', 'medium', 'fast', 'default', 'custom'] as speed}
                  <button
                    on:click={() => {
                      agcSpeed = speed;
                      if (audio && audio.setAGCSpeed) {
                        if (speed === 'custom') {
                          audio.setAGCSpeed(speed, customAttack, customRelease);
                        } else {
                          audio.setAGCSpeed(speed);
                        }
                      }
                    }}
                    class="option-button {agcSpeed === speed ? 'active' : ''}"
                  >
                    {speed.charAt(0).toUpperCase() + speed.slice(1)}
                  </button>
                {/each}
              </div>
              
              {#if agcSpeed === 'custom'}
                <div class="custom-agc-controls">
                  <div class="custom-control">
                    <label class="custom-label">Attack (ms)</label>
                    <input
                      type="range"
                      bind:value={customAttack}
                      on:input={() => {
                        if (audio && audio.setAGCSpeed) {
                          audio.setAGCSpeed('custom', customAttack, customRelease);
                        }
                      }}
                      min="0.1"
                      max="100"
                      step="0.1"
                      class="custom-slider"
                    />
                    <span class="custom-value">{customAttack.toFixed(1)}</span>
                  </div>
                  <div class="custom-control">
                    <label class="custom-label">Release (ms)</label>
                    <input
                      type="range"
                      bind:value={customRelease}
                      on:input={() => {
                        if (audio && audio.setAGCSpeed) {
                          audio.setAGCSpeed('custom', customAttack, customRelease);
                        }
                      }}
                      min="10"
                      max="1000"
                      step="10"
                      class="custom-slider"
                    />
                    <span class="custom-value">{customRelease.toFixed(0)}</span>
                  </div>
                </div>
              {/if}
            </div>
            
            <!-- Buffer Size Setting -->
            <div class="setting-card">
              <h4 class="setting-title">Buffer Size</h4>
              <div class="button-group">
                {#each ['small', 'medium', 'large'] as size}
                  <button
                    on:click={() => {
                      bufferSize = size;
                      if (audio && audio.setBufferSize) {
                        audio.setBufferSize(size);
                      }
                    }}
                    class="option-button {bufferSize === size ? 'active' : ''}"
                  >
                    {size.charAt(0).toUpperCase() + size.slice(1)}
                  </button>
                {/each}
              </div>
              <p class="setting-hint">
                Small: Lower latency • Large: More stable
              </p>
            </div>
            
            <!-- Frequency Step Settings -->
            <div class="setting-card">
              <h4 class="setting-title">Frequency Step Settings</h4>
              
              <div class="step-controls">
                <div class="step-control">
                  <label class="step-label">Mouse Wheel Step (Hz)</label>
                  <div class="dropdown-container">
                    <button
                      class="custom-select-trigger"
                      on:click|stopPropagation={() => toggleDropdown('mouseWheel')}
                      aria-expanded={showMouseWheelDropdown}
                      aria-haspopup="listbox"
                    >
                      <span class="select-value">{mouseWheelStep}</span>
                      <div class="select-icon" class:rotated={showMouseWheelDropdown}>
                        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </div>
                    </button>
                    
                    {#if showMouseWheelDropdown}
                      <div class="custom-dropdown">
                        <div class="dropdown-inner">
                          {#each [0.5, 1, 5, 10, 12.5, 25] as step}
                            <button
                              class="dropdown-option {mouseWheelStep === step ? 'active' : ''}"
                              on:click|stopPropagation={() => {
                                frequencySteps.update(current => ({
                                  ...current,
                                  mouseWheelStep: step
                                }));
                                showMouseWheelDropdown = false;
                              }}
                            >
                              {step}
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
                
                <div class="step-control">
                  <label class="step-label">Keyboard Arrow Step (Hz)</label>
                  <div class="dropdown-container">
                    <button
                      class="custom-select-trigger"
                      on:click|stopPropagation={() => toggleDropdown('keyboard')}
                      aria-expanded={showKeyboardDropdown}
                      aria-haspopup="listbox"
                    >
                      <span class="select-value">{keyboardStep}</span>
                      <div class="select-icon" class:rotated={showKeyboardDropdown}>
                        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </div>
                    </button>
                    
                    {#if showKeyboardDropdown}
                      <div class="custom-dropdown">
                        <div class="dropdown-inner">
                          {#each [0.5, 1, 5, 10, 12.5, 25] as step}
                            <button
                              class="dropdown-option {keyboardStep === step ? 'active' : ''}"
                              on:click|stopPropagation={() => {
                                frequencySteps.update(current => ({
                                  ...current,
                                  keyboardStep: step
                                }));
                                showKeyboardDropdown = false;
                              }}
                            >
                              {step}
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
                
                <div class="step-control">
                  <label class="step-label">Keyboard Jump Step (Hz)</label>
                  <div class="dropdown-container">
                    <button
                      class="custom-select-trigger"
                      on:click|stopPropagation={() => toggleDropdown('jump')}
                      aria-expanded={showJumpDropdown}
                      aria-haspopup="listbox"
                    >
                      <span class="select-value">{keyboardJumpStep}</span>
                      <div class="select-icon" class:rotated={showJumpDropdown}>
                        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </div>
                    </button>
                    
                    {#if showJumpDropdown}
                      <div class="custom-dropdown">
                        <div class="dropdown-inner">
                          {#each [10, 25, 50, 100, 250, 500] as step}
                            <button
                              class="dropdown-option {keyboardJumpStep === step ? 'active' : ''}"
                              on:click|stopPropagation={() => {
                                frequencySteps.update(current => ({
                                  ...current,
                                  keyboardJumpStep: step
                                }));
                                showJumpDropdown = false;
                              }}
                            >
                              {step}
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
              
              <p class="setting-hint">
                Mouse wheel: normal scroll • Keyboard: Up/Down arrows • Jump: Left/Right arrows
              </p>
            </div>
          </div>
        {/if}
      </div>
      
    </div>
  </div>
{/if}

<!-- Keybinds Modal -->
{#if showKeybindsModal}
  <div class="modal-container">
    <div
      class="modal-backdrop"
      on:click={() => showKeybindsModal = false}
      transition:fade={{ duration: 150 }}
    ></div>
    
    <div
      class="modal-content keybinds-modal"
      transition:scale={{ duration: 200, easing: quintOut, start: 0.95 }}
    >
      <!-- Header -->
      <div class="modal-header">
        <h2 class="modal-title">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="header-icon">
            <rect x="3" y="5" width="14" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
            <rect x="5" y="7" width="2" height="2" fill="currentColor"/>
            <rect x="9" y="7" width="2" height="2" fill="currentColor"/>
            <rect x="13" y="7" width="2" height="2" fill="currentColor"/>
            <rect x="5" y="11" width="2" height="2" fill="currentColor"/>
            <rect x="9" y="11" width="2" height="2" fill="currentColor"/>
            <rect x="13" y="11" width="2" height="2" fill="currentColor"/>
          </svg>
          Keyboard Shortcuts
        </h2>
        <button
          on:click={() => showKeybindsModal = false}
          class="close-button"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      
      <!-- Content -->
      <div class="modal-body keybinds-body">
        <!-- Frequency Control -->
        <div class="keybind-section">
          <h3 class="keybind-category">Frequency Control</h3>
          <div class="keybind-list">
            <div class="keybind-item">
              <span class="keybind-description">Tune up 50 Hz</span>
              <div class="keybind-keys">
                <kbd>↑</kbd>
                <span class="key-separator">or</span>
                <kbd>Scroll Up</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Tune down 50 Hz</span>
              <div class="keybind-keys">
                <kbd>↓</kbd>
                <span class="key-separator">or</span>
                <kbd>Scroll Down</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Tune up/down 100 Hz</span>
              <div class="keybind-keys">
                <kbd>Shift</kbd>
                <span class="key-plus">+</span>
                <kbd>↑/↓</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Tune up/down 1 kHz</span>
              <div class="keybind-keys">
                <kbd>←</kbd>
                <span class="key-separator">/</span>
                <kbd>→</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Tune up/down 10 kHz</span>
              <div class="keybind-keys">
                <kbd>Shift</kbd>
                <span class="key-plus">+</span>
                <kbd>←/→</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Switch VFO A/B</span>
              <div class="keybind-keys">
                <kbd>V</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Set frequency input</span>
              <div class="keybind-keys">
                <kbd>Enter</kbd>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Waterfall Control -->
        <div class="keybind-section">
          <h3 class="keybind-category">Waterfall Display</h3>
          <div class="keybind-list">
            <div class="keybind-item">
              <span class="keybind-description">Zoom in waterfall</span>
              <div class="keybind-keys">
                <kbd>+</kbd>
                <span class="key-separator">or</span>
                <kbd>=</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Zoom out waterfall</span>
              <div class="keybind-keys">
                <kbd>-</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Maximum zoom</span>
              <div class="keybind-keys">
                <kbd>0</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Reset zoom</span>
              <div class="keybind-keys">
                <kbd>9</kbd>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Mode Selection -->
        <div class="keybind-section">
          <h3 class="keybind-category">Mode Selection</h3>
          <div class="keybind-list">
            <div class="keybind-item">
              <span class="keybind-description">USB mode</span>
              <div class="keybind-keys">
                <kbd>U</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">LSB mode</span>
              <div class="keybind-keys">
                <kbd>L</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">AM mode</span>
              <div class="keybind-keys">
                <kbd>A</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">FM mode</span>
              <div class="keybind-keys">
                <kbd>F</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">CW mode</span>
              <div class="keybind-keys">
                <kbd>C</kbd>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Audio Control -->
        <div class="keybind-section">
          <h3 class="keybind-category">Audio Control</h3>
          <div class="keybind-list">
            <div class="keybind-item">
              <span class="keybind-description">Mute/Unmute</span>
              <div class="keybind-keys">
                <kbd>Space</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Toggle squelch</span>
              <div class="keybind-keys">
                <kbd>S</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Start/stop recording</span>
              <div class="keybind-keys">
                <kbd>R</kbd>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Other Controls -->
        <div class="keybind-section">
          <h3 class="keybind-category">Other Controls</h3>
          <div class="keybind-list">
            <div class="keybind-item">
              <span class="keybind-description">Open band selection</span>
              <div class="keybind-keys">
                <kbd>G</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Open bookmarks</span>
              <div class="keybind-keys">
                <kbd>B</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Toggle noise reduction</span>
              <div class="keybind-keys">
                <kbd>N</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Toggle auto notch</span>
              <div class="keybind-keys">
                <kbd>T</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Show keyboard shortcuts</span>
              <div class="keybind-keys">
                <kbd>?</kbd>
              </div>
            </div>
            <div class="keybind-item">
              <span class="keybind-description">Close dialog/modal</span>
              <div class="keybind-keys">
                <kbd>Esc</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Footer -->
      <div class="modal-footer">
        <span class="footer-hint">Press any key combination to see its function</span>
        <button
          on:click={() => showKeybindsModal = false}
          class="action-button"
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Container */
  .server-info-container {
    width: 100%;
    margin-bottom: 0.5rem;
  }
  
  /* Mobile location badge */
  .mobile-location-badge {
    display: none;
  }
  
  .desktop-only {
    display: inline-flex;
  }
  
  .server-info-card {
    background: #1c1c1e;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 1rem;
    padding: 1.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    position: relative;
  }
  
  /* Action Buttons */
  .action-buttons {
    position: absolute;
    top: 1rem;
    right: 1rem;
    display: flex;
    gap: 0.5rem;
  }
  
  .icon-button {
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    color: #a1a1a6;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .icon-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: #f5f5f7;
  }
  
  /* Header Section */
  .header-section {
    text-align: center;
    margin-bottom: 1.5rem;
  }
  
  .server-name {
    font-size: 1.875rem;
    font-weight: 600;
    color: #f5f5f7;
    letter-spacing: -0.02em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.75rem;
    justify-content: center;
    margin-bottom: 0.5rem;
  }
  
  .location-badge {
    font-size: 0.875rem;
    font-weight: 500;
    color: #0071e3;
    background: rgba(0, 113, 227, 0.1);
    padding: 0.375rem 1rem;
    border-radius: 9999px;
    backdrop-filter: blur(8px);
  }
  
  .operator-info {
    font-size: 0.875rem;
    color: #a1a1a6;
    margin-bottom: 0.25rem;
  }
  
  .operator-name {
    color: #e5e5e7;
    font-weight: 500;
  }
  
  .email-wrapper {
    margin: 0.5rem 0;
  }
  
  .email-link {
    font-size: 0.875rem;
    color: #0071e3;
    text-decoration: none;
    transition: color 0.15s ease;
    display: inline-block;
  }
  
  .email-link:hover {
    color: #0077ed;
    text-decoration: underline;
  }
  
  .network-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0.625rem 1.25rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.625rem;
    font-size: 0.875rem;
    color: #0071e3;
    text-decoration: none;
    transition: all 0.15s ease;
  }
  
  .network-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    transform: translateY(-1px);
  }
  
  /* Lookup Grid */
  .lookup-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-top: 1.5rem;
  }
  
  @media (max-width: 640px) {
    .lookup-grid {
      grid-template-columns: 1fr;
    }
    
    /* Mobile layout */
    .server-info-card {
      padding: 1rem;
      padding-top: 1rem;
    }
    
    /* Mobile location badge at top */
    .mobile-location-badge {
      display: block;
      position: absolute;
      top: 1rem;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.875rem;
      font-weight: 600;
      color: #0071e3;
      background: rgba(0, 113, 227, 0.1);
      padding: 0.375rem 1rem;
      border-radius: 9999px;
      z-index: 5;
    }
    
    /* Hide desktop location badge */
    .desktop-only {
      display: none;
    }
    
    .action-buttons {
      top: 0.75rem;
      right: 0.5rem;
      z-index: 10;
    }
    
    .icon-button {
      padding: 0.375rem;
      width: 2rem;
      height: 2rem;
    }
    
    .icon-button svg {
      width: 16px;
      height: 16px;
    }
    
    /* Center content below location badge */
    .header-section {
      text-align: center;
      padding-right: 0;
      margin-top: 3rem; /* Space for location badge */
    }
    
    .server-name {
      font-size: 1.5rem;
      padding: 0;
      word-break: break-word;
      line-height: 1.2;
      justify-content: center;
    }
    
    /* Center all header content */
    .operator-info,
    .email-wrapper {
      text-align: center;
    }
    
    .network-button {
      margin: 1rem auto 0;
    }
  }
  
  .lookup-section {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.75rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(8px);
  }
  
  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #a1a1a6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
    text-align: center;
  }
  
  .lookup-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
  
  .lookup-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    color: #e5e5e7;
    text-decoration: none;
    transition: all 0.15s ease;
  }
  
  .lookup-link:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: #f5f5f7;
    transform: scale(1.02);
  }
  
  .callsign-form {
    display: flex;
    gap: 0.5rem;
  }
  
  .callsign-input {
    flex: 1;
    padding: 0.625rem 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    outline: none;
    transition: all 0.15s ease;
  }
  
  .callsign-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #0071e3;
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2);
  }
  
  .callsign-input::placeholder {
    color: #6e6e73;
    font-style: italic;
  }
  
  .lookup-button {
    padding: 0.625rem 1.25rem;
    background: #0071e3;
    color: white;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .lookup-button:hover:not(:disabled) {
    background: #0077ed;
    transform: scale(1.02);
  }
  
  .lookup-button:active:not(:disabled) {
    background: #006edb;
  }
  
  .lookup-button:disabled {
    background: #2c2c2e;
    color: #6e6e73;
    cursor: not-allowed;
    transform: none;
  }
  
  /* Modal Styles */
  .modal-container {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  
  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  
  .modal-content {
    position: relative;
    background: #1c1c1e;
    border-radius: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    max-height: 85vh;
  }
  
  .settings-modal {
    width: 100%;
    max-width: 28rem;
  }
  
  .keybinds-modal {
    width: 100%;
    max-width: 48rem;
  }
  
  /* Mobile modal optimization */
  @media (max-width: 768px) {
    .modal-container {
      padding: 0.5rem;
      align-items: flex-start;
      padding-top: 2rem;
    }
    
    .modal-content {
      max-height: 90vh;
      border-radius: 0.75rem;
      margin: 0;
      width: 100%;
      max-width: 100%;
    }
    
    .settings-modal {
      max-width: 100%;
    }
    
    .keybinds-modal {
      max-width: 100%;
    }
    
    .modal-header {
      padding: 1rem;
      border-radius: 0.75rem 0.75rem 0 0;
    }
    
    .modal-body {
      padding: 1rem;
    }
    
    .modal-footer {
      padding: 1rem;
      border-radius: 0 0 0.75rem 0.75rem;
    }
    
    /* Mobile-specific settings optimizations */
    .step-control {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    
    .step-label {
      font-size: 0.875rem;
      align-self: flex-start;
    }
    
    .dropdown-container {
      width: 100%;
      min-width: auto;
    }
    
    .custom-select-trigger {
      width: 100%;
      min-width: 120px;
    }
    
    /* Stats grid mobile optimization */
    .stats-grid {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    
    .button-group {
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .option-button {
      width: 100%;
    }
  }
  
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  
  .modal-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #f5f5f7;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .header-icon {
    color: #0071e3;
  }
  
  .close-button {
    padding: 0.5rem;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: #a1a1a6;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .close-button:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #f5f5f7;
  }
  
  /* Tab Bar */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0 0.5rem;
  }
  
  .tab-button {
    padding: 1rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #a1a1a6;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .tab-button:hover {
    color: #e5e5e7;
  }
  
  .tab-button.active {
    color: #0071e3;
    border-bottom-color: #0071e3;
  }
  
  /* Modal Body */
  .modal-body {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .keybinds-body {
    max-height: 32rem;
  }
  
  /* Settings Content */
  .content-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f5f5f7;
    margin-bottom: 1rem;
  }
  
  .setting-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 1rem;
  }
  
  .setting-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
    margin-bottom: 0.75rem;
  }
  
  .button-group {
    display: flex;
    gap: 0.5rem;
  }
  
  .option-button {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    font-weight: 500;
    font-size: 0.875rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .option-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
  }
  
  .option-button.active {
    background: #0071e3;
    color: white;
    border-color: #0071e3;
  }
  
  .setting-hint {
    font-size: 0.75rem;
    color: #6e6e73;
    margin-top: 0.5rem;
  }
  
  /* Custom AGC Controls */
  .custom-agc-controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1rem;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }
  
  .custom-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .custom-label {
    font-size: 0.75rem;
    color: #a1a1a6;
    min-width: 5rem;
  }
  
  .custom-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    border-radius: 2px;
  }
  
  .custom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: #0071e3;
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.15s ease;
  }
  
  .custom-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #0071e3;
    cursor: pointer;
    border-radius: 50%;
    border: none;
    transition: all 0.15s ease;
  }
  
  .custom-slider:hover::-webkit-slider-thumb {
    transform: scale(1.1);
    background: #0077ed;
  }
  
  .custom-slider:hover::-moz-range-thumb {
    transform: scale(1.1);
    background: #0077ed;
  }
  
  .custom-value {
    font-size: 0.75rem;
    font-family: 'SF Mono', monospace;
    color: #0071e3;
    min-width: 3rem;
    text-align: right;
  }
  
  /* Step Controls */
  .step-controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .step-control {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  
  .step-label {
    font-size: 0.875rem;
    color: #e5e5e7;
    font-weight: 500;
  }
  
  .dropdown-container {
    position: relative;
    min-width: 6rem;
  }
  
  .custom-select-trigger {
    width: 100%;
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-family: 'SF Mono', monospace;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    appearance: none;
    cursor: pointer;
    transition: all 0.15s ease;
    outline: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-align: left;
  }
  
  .custom-select-trigger:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
  }
  
  .custom-select-trigger:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #0071e3;
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2);
  }
  
  .select-value {
    flex: 1;
  }
  
  .select-icon {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    transition: transform 0.2s ease;
    color: #a1a1a6;
  }
  
  .select-icon.rotated {
    transform: translateY(-50%) rotate(180deg);
  }
  
  .custom-dropdown {
    position: absolute;
    left: 0;
    right: 0;
    background: rgba(28, 28, 30, 0.98);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.625rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    z-index: 100;
    overflow: hidden;
    animation: dropdownFadeIn 0.2s ease-out;
    
    /* Default positioning (dropdown below) */
    top: 100%;
    margin-top: 0.25rem;
    transform-origin: top;
  }
  
  /* Smart positioning - flip dropdown upward when near bottom */
  .setting-card:last-child .custom-dropdown,
  .setting-card:nth-last-child(1) .custom-dropdown {
    top: auto;
    bottom: 100%;
    margin-top: 0;
    margin-bottom: 0.25rem;
    transform-origin: bottom;
    animation: dropdownFadeInUp 0.2s ease-out;
  }
  
  .dropdown-inner {
    max-height: 200px;
    overflow-y: auto;
    padding: 0.25rem;
    /* Custom scrollbar styling */
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.1);
  }
  
  .dropdown-inner::-webkit-scrollbar {
    width: 6px;
  }
  
  .dropdown-inner::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  
  .dropdown-inner::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 3px;
  }
  
  .dropdown-inner::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.5);
  }
  
  .dropdown-option {
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-family: 'SF Mono', monospace;
    color: #e5e5e7;
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    display: block;
  }
  
  .dropdown-option:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f5f5f7;
  }
  
  .dropdown-option.active {
    background: rgba(0, 113, 227, 0.2);
    color: #0fb7e6;
    font-weight: 500;
  }
  
  .dropdown-option.active:hover {
    background: rgba(0, 113, 227, 0.3);
  }
  
  @keyframes dropdownFadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  @keyframes dropdownFadeInUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  /* Debug Content */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .stat-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.5rem;
    padding: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  .stat-label {
    font-size: 0.75rem;
    color: #a1a1a6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }
  
  .stat-value {
    font-size: 1.125rem;
    font-weight: 500;
    font-family: 'SF Mono', monospace;
  }
  
  .stat-detail {
    font-size: 0.75rem;
    color: #a1a1a6;
    margin-left: 0.5rem;
  }
  
  /* Graph */
  .graph-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  .graph-label {
    font-size: 0.75rem;
    color: #a1a1a6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }
  
  .graph-container {
    position: relative;
    height: 8rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
    padding: 0.5rem;
  }
  
  .graph-svg {
    width: 100%;
    height: 100%;
  }
  
  .graph-y-labels {
    position: absolute;
    left: 0;
    top: 0.5rem;
    bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 0.625rem;
    color: #6e6e73;
    padding-right: 0.5rem;
  }
  
  .graph-x-labels {
    position: absolute;
    bottom: -1rem;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    font-size: 0.625rem;
    color: #6e6e73;
  }
  
  .current-value {
    margin-top: 1rem;
    text-align: center;
    font-size: 0.875rem;
    color: #a1a1a6;
  }
  
  .current-value span {
    font-size: 1rem;
    font-weight: 600;
    font-family: 'SF Mono', monospace;
  }
  
  /* Keybinds */
  .keybind-section {
    margin-bottom: 1.5rem;
  }
  
  .keybind-section:last-child {
    margin-bottom: 0;
  }
  
  .keybind-category {
    font-size: 0.75rem;
    font-weight: 600;
    color: #a1a1a6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }
  
  .keybind-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .keybind-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.5rem;
  }
  
  .keybind-description {
    font-size: 0.875rem;
    color: #e5e5e7;
  }
  
  .keybind-keys {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  
  kbd {
    padding: 0.25rem 0.625rem;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: 'SF Mono', monospace;
    color: #f5f5f7;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  
  .key-separator,
  .key-plus {
    font-size: 0.75rem;
    color: #6e6e73;
  }
  
  /* Modal Footer */
  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  
  .footer-hint {
    font-size: 0.75rem;
    color: #6e6e73;
  }
  
  .action-button {
    padding: 0.5rem 1.25rem;
    background: rgba(255, 255, 255, 0.08);
    color: #e5e5e7;
    font-weight: 500;
    font-size: 0.875rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .action-button:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.16);
    color: #f5f5f7;
  }
  
  .action-button:active {
    background: rgba(255, 255, 255, 0.16);
    transform: scale(0.98);
  }
  
  /* Color utilities */
  .text-blue-500 { color: #0071e3; }
  .text-green-500 { color: #32d74b; }
  .text-yellow-500 { color: #ffd60a; }
  .text-red-500 { color: #ff3b30; }
  .text-purple-500 { color: #af52de; }
  .text-gray-500 { color: #6e6e73; }
  
  /* Responsive */
  @media (min-width: 87rem) {
    .server-info-container {
      min-width: 86rem;
    }
  }
  
  /* Scrollbar */
  .modal-body::-webkit-scrollbar {
    width: 8px;
  }
  
  .modal-body::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
  }
  
  .modal-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
  
  .modal-body::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  /* Config Tab Styles */
  .config-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .config-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .action-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.05);
    color: #e5e5e7;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .action-button:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .export-button:hover {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
    color: #22c55e;
  }

  .import-button:hover {
    background: rgba(59, 130, 246, 0.1);
    border-color: rgba(59, 130, 246, 0.3);
    color: #3b82f6;
  }

  .clear-button:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
  }

  .success-message {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #22c55e;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .config-description {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.375rem;
    padding: 1rem;
  }

  .config-desc-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.7);
    margin: 0;
    line-height: 1.4;
  }
</style>