<script>
    const VERSION = "2.0.0";

    import { onDestroy, onMount, tick } from "svelte";
    import { writable } from "svelte/store";
    import { fade, fly } from "svelte/transition";
    import { quintOut } from "svelte/easing";

    // Component imports
    import AppFooter from "./components/AppFooter.svelte";
    import ChatPanel from "./components/ChatPanel.svelte";
    import BookmarkDialog from "./components/BookmarkDialog.svelte";
    import WaterfallControls from "./components/WaterfallControls.svelte";
    import AudioPanel from "./components/AudioPanel.svelte";
    import DemodBandwidthPanel from "./components/DemodBandwidthPanel.svelte";
    import TutorialOverlay from "./components/TutorialOverlay.svelte";
    import AudioGateOverlay from "./components/AudioGateOverlay.svelte";
    import DisplayStack from "./components/DisplayStack.svelte";
    import ServerInfo from "./components/ServerInfo.svelte";
    import BandsMenu from "./components/BandsMenu.svelte";
    import MobileBottomBar from "./components/MobileBottomBar.svelte";
    import { serverInfo } from "./stores/serverInfo.js";
import { frequencySteps } from "./stores/frequencySteps.js";

    import { eventBus } from "./eventBus";

    import {
        init,
        audio,
        waterfall,
        events,
        FFTOffsetToFrequency,
        frequencyToFFTOffset,
        waterfallOffsetToFrequency,
    } from "./lib/backend.js";
    import {
        constructLink,
        parseLink,
        storeInLocalStorage,
    } from "./lib/storage.js";

    // Component references
    let frequencyInputComponent;
    let passbandTunerComponent;
    let frequencyMarkerComponent;
    let displayStackComponent;
    let audioPanel;
    let demodBandwidthPanel;
    let mobileBottomBar;

    // State
    let frequency = "14074.00";
    let demodulation = "USB";
    let bandwidth = "2.8";
    let link = "";
    let showBookmarkDialog = false;
    let showBandsMenu = false;
    
    // Watch for changes to emit close events
    $: if (!showBandsMenu) {
        eventBus.publish("bandsMenuClosed");
    }
    
    $: if (!showBookmarkDialog) {
        eventBus.publish("bookmarksDialogClosed");
    }
    let audioGateVisible = true;
    let showTutorial = false;
    let vfoSwitchNotification = "";

    // VFO State - will be initialized with server defaults
    let currentVFO = "A";
    let vfoA = {
        frequency: null,
        demodulation: null,
        bandwidth: null,
        audioRange: null,
        waterfallRange: null,
        zoom: null,
    };
    let vfoB = {
        frequency: null,
        demodulation: null,
        bandwidth: null,
        audioRange: null,
        waterfallRange: null,
        zoom: null,
    };

    // Reactive audio panel states
    $: NREnabled = audioPanel?.NREnabled || false;
    $: NBEnabled = audioPanel?.NBEnabled || false;
    $: ANEnabled = audioPanel?.ANEnabled || false;
    $: CTCSSSupressEnabled = audioPanel?.CTCSSSupressEnabled || false;
    $: mute = audioPanel?.mute || false;

    // Update interval for regular UI updates
    let updateInterval;
    let lastUpdated = 0;
    let vfoNotificationTimeout;

    // Audio gate handler
    function handleAudioGateClick() {
        audioGateVisible = false;
        if (audio && audio.enable) {
            audio.enable();
        }
    }

    // VFO functions
    function saveCurrentVFO() {
        const vfo = currentVFO === "A" ? vfoA : vfoB;
        vfo.frequency =
            frequencyInputComponent?.getFrequency() ||
            parseFloat(frequency) * 1000;
        vfo.demodulation = demodulation;
        vfo.bandwidth = parseFloat(bandwidth);
        vfo.audioRange = audio.getAudioRange();
        vfo.waterfallRange = waterfall.getWaterfallRange();
    }

    function loadVFO(vfoName) {
        const vfo = vfoName === "A" ? vfoA : vfoB;

        // Restore frequency
        if (vfo.frequency && frequencyInputComponent) {
            frequencyInputComponent.setFrequency(vfo.frequency);
            handleFrequencyChange({ detail: vfo.frequency });
        }

        // Restore demodulation
        if (vfo.demodulation) {
            demodulation = vfo.demodulation;
            if (demodBandwidthPanel) {
                demodBandwidthPanel.SetMode(vfo.demodulation);
            }
        }

        // Restore waterfall range
        if (vfo.waterfallRange) {
            waterfall.setWaterfallRange(...vfo.waterfallRange);
        }
    }

    function switchVFO() {
        // Clear any existing timeout
        if (vfoNotificationTimeout) {
            clearTimeout(vfoNotificationTimeout);
        }

        // Save current VFO state
        saveCurrentVFO();

        // Switch to other VFO
        currentVFO = currentVFO === "A" ? "B" : "A";

        // Load new VFO state
        loadVFO(currentVFO);

        // Show notification
        vfoSwitchNotification = `Switched to VFO ${currentVFO}`;

        // Set new timeout - shorter duration for snappier feel
        vfoNotificationTimeout = setTimeout(() => {
            vfoSwitchNotification = "";
        }, 1200); // Reduced from 2000ms
    }

    // Update link
    function updateLink() {
        const linkObj = {
            frequency: frequencyInputComponent?.getFrequency()?.toFixed(0) || 0,
            modulation: demodulation,
        };
        frequency = (
            (frequencyInputComponent?.getFrequency() || 0) / 1e3
        ).toFixed(2);
        const linkQuery = constructLink(linkObj);
        link = `${location.origin}${location.pathname}?${linkQuery}`;
        history.replaceState(null, '', link);
        storeInLocalStorage(linkObj);
    }

    // Regular UI update tick
    function updateTick() {
        // Update signal meter in audio panel
        if (audioPanel) {
            audioPanel.updateSignalMeter();
        }

        // Update other user displays
        if (events.getLastModified() > lastUpdated) {
            const myRange = audio.getAudioRange();
            const clients = events.getSignalClients();
            // Don't show our own tuning
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

    // Handle frequency input display
    function handleWheel(node) {
        function onWheel(event) {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -1 : 1;
            const isShiftPressed = event.shiftKey;

            let frequencyHz = Math.round(parseFloat(frequency) * 1e3);

            function adjustFrequency(freq, direction, shiftPressed) {
                const step = shiftPressed ? $frequencySteps.mouseWheelStep * 2 : $frequencySteps.mouseWheelStep;
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
            frequency = (frequencyHz / 1e3).toFixed(2);

            frequencyInputComponent.setFrequency(frequencyHz);
            eventBus.publish("frequencyChange", { detail: frequencyHz });
        }

        node.addEventListener("wheel", onWheel);

        return {
            destroy() {
                node.removeEventListener("wheel", onWheel);
            },
        };
    }

    // Event handlers
    function handleFrequencyChange(event) {
        const newFrequency = event.detail;
        const audioRange = audio.getAudioRange();

        const [l, m, r] = audioRange.map(FFTOffsetToFrequency);

        // Preserve current bandwidth settings
        let audioParameters = [
            newFrequency - (m - l),
            newFrequency,
            newFrequency + (r - m),
        ].map(frequencyToFFTOffset);
        const newm = audioParameters[1];

        const lOffset = newFrequency - (m - l) - 200;
        const mOffset = newFrequency - 750;
        const rOffset = newFrequency + (r - m) - 200;

        const audioParametersOffset = [lOffset, mOffset, rOffset].map(
            frequencyToFFTOffset,
        );

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
        displayStackComponent.updatePassband();
        updateLink();
        if (!event.markerclick) {
            waterfall.checkBandAndSetMode &&
                waterfall.checkBandAndSetMode(newFrequency);
        }
        frequencyMarkerComponent.updateFrequencyMarkerPositions();
    }

    function handleWaterfallMagnify(e, type) {
        let [l, m, r] = audio.getAudioRange();
        const [waterfallL, waterfallR] = waterfall.getWaterfallRange();
        const offset =
            ((m - waterfallL) / (waterfallR - waterfallL)) *
            waterfall.canvasWidth;

        switch (type) {
            case "max":
                m = Math.min(
                    waterfall.waterfallMaxSize - 512,
                    Math.max(512, m),
                );
                l = Math.floor(m - 512);
                r = Math.ceil(m + 512);
                break;
            case "+":
                e.coords = { x: offset };
                e.scale = -1;
                waterfall.canvasWheel(e);
                displayStackComponent.updatePassband();
                frequencyMarkerComponent.updateFrequencyMarkerPositions();
                return;
            case "-":
                e.coords = { x: offset };
                e.scale = 1;
                waterfall.canvasWheel(e);
                displayStackComponent.updatePassband();
                frequencyMarkerComponent.updateFrequencyMarkerPositions();
                return;
            case "min":
                l = 0;
                r = waterfall.waterfallMaxSize;
                break;
        }
        waterfall.setWaterfallRange(l, r);
        frequencyMarkerComponent.updateFrequencyMarkerPositions();
        displayStackComponent.updatePassband();
    }

    // S-meter drawing
    function drawSMeter(activeSegments) {
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
            if (i < activeSegments) {
                ctx.fillStyle = i < 17 ? "#0071e3" : "#ff3b30";
            } else {
                ctx.fillStyle =
                    i < 17
                        ? "rgba(0, 113, 227, 0.2)"
                        : "rgba(255, 59, 48, 0.2)";
            }
            ctx.fillRect(x, 0, segmentWidth, segmentHeight);
        }

        ctx.font =
            "11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
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

    let backendPromise;
    onMount(async () => {
        // Check if background image loads successfully
        const checkBackgroundImage = () => {
            const img = new Image();
            img.onload = () => {
                document.body.classList.add('background-loaded');
            };
            img.onerror = () => {
                // Try PNG if JPG fails
                const imgPng = new Image();
                imgPng.onload = () => {
                    document.body.classList.add('background-loaded');
                };
                imgPng.src = '/assets/background.png';
            };
            img.src = '/assets/background.jpg';
        };
        checkBackgroundImage();
        
        // Initialize backend
        backendPromise = init();
        await backendPromise;

        // Enable after connection established
        [
            ...document.getElementsByTagName("button"),
            ...document.getElementsByTagName("input"),
        ].forEach((element) => {
            element.disabled = false;
        });

        // Initialize components
        if (demodBandwidthPanel) {
            demodBandwidthPanel.initialize();
        }

        frequencyInputComponent.setFrequency(
            audio.settings.defaults.frequency,
        );
        frequencyInputComponent.updateFrequencyLimits(
            audio.baseFreq,
            audio.baseFreq + audio.totalBandwidth,
        );

        demodulation = audio.settings.defaults.modulation;

        // Initialize both VFOs with server defaults
        const defaultFrequency = audio.settings.defaults.frequency;
        const defaultModulation = audio.settings.defaults.modulation;
        const defaultBandwidth = parseFloat(bandwidth);

        // Initialize VFO A and B with same defaults
        vfoA = {
            frequency: defaultFrequency,
            demodulation: defaultModulation,
            bandwidth: defaultBandwidth,
            audioRange: audio.getAudioRange(),
            waterfallRange: waterfall.getWaterfallRange(),
            zoom: null,
        };

        vfoB = {
            frequency: defaultFrequency,
            demodulation: defaultModulation,
            bandwidth: defaultBandwidth,
            audioRange: audio.getAudioRange(),
            waterfallRange: waterfall.getWaterfallRange(),
            zoom: null,
        };

        // Update parameters from URL
        const updateParameters = (linkParameters) => {
            // Use server defaults if no URL parameters provided
            if (!linkParameters.frequency) {
                linkParameters.frequency = audio.settings.defaults.frequency;
            }
            if (!linkParameters.modulation) {
                linkParameters.modulation = audio.settings.defaults.modulation;
            }
            
            frequencyInputComponent.setFrequency(linkParameters.frequency);
            if (
                frequencyInputComponent.getFrequency() ===
                linkParameters.frequency
            ) {
                handleFrequencyChange({ detail: linkParameters.frequency });
            }
            if (linkParameters.modulation) {
                demodulation = linkParameters.modulation;
                demodBandwidthPanel.SetMode(demodulation);
            }
            frequencyMarkerComponent.updateFrequencyMarkerPositions();
        };

        const linkParameters = parseLink(location.search.slice(1));
        updateParameters(linkParameters);

        // Initialize audio panel volume after backend is ready
        if (audioPanel) {
            audioPanel.initializeAudio();
        }

        // Ensure demodulation is set before passband initialization
        if (demodBandwidthPanel) {
            demodBandwidthPanel.SetMode(demodulation);
        }

        // Initial update - wait for next tick to ensure components are ready
        await tick();
        displayStackComponent.updatePassband();
        passbandTunerComponent.updatePassbandLimits();
        updateLink();
        
        // Connect mobile bottom bar to passband tuner
        if (mobileBottomBar && passbandTunerComponent) {
            mobileBottomBar.setPassbandTuner(passbandTunerComponent);
        }
        
        // Set up reactive connection for mobile bottom bar
        $: if (mobileBottomBar && passbandTunerComponent) {
            mobileBottomBar.setPassbandTuner(passbandTunerComponent);
        }

        // Start update interval
        updateInterval = setInterval(
            () => requestAnimationFrame(updateTick),
            200,
        );

        // Set up global references
        window["spectrumAudio"] = audio;
        window["spectrumWaterfall"] = waterfall;

        // Check for tutorial
        if (!localStorage.getItem("phantomSDRTutorialCompleted")) {
            await tick();
            showTutorial = true;
        }

        // Event bus subscriptions
        eventBus.subscribe("frequencyChange", handleFrequencyChange);

        eventBus.subscribe("setMode", (mode) => {
            // Update the demodulation state directly instead of calling SetMode
            demodulation = mode;
            // Call the internal handler to update audio settings with the new mode
            if (demodBandwidthPanel) {
                // We need to wait for the next tick to ensure the prop is updated
                tick().then(() => {
                    demodBandwidthPanel.handleDemodulationChange(null, true);
                });
            }
        });

        eventBus.subscribe("demodulationChange", (data) => {
            demodulation = data.demodulation;
            frequency = (data.frequency / 1e3).toFixed(2);
            updateLink();
        });

        eventBus.subscribe("passbandChange", (data) => {
            const { frequencies, offsets } = data;
            bandwidth = ((frequencies[2] - frequencies[0]) / 1000).toFixed(2);
            frequencyInputComponent.setFrequency(frequencies[1]);
            frequency = (frequencyInputComponent.getFrequency() / 1e3).toFixed(
                2,
            );

            const audioParameters = frequencies.map(frequencyToFFTOffset);
            const audioParametersOffset = offsets.map(frequencyToFFTOffset);

            audio.setAudioRange(...audioParameters, ...audioParametersOffset);
            updateLink();
            displayStackComponent.updatePassband();
            waterfall.checkBandAndSetMode &&
                waterfall.checkBandAndSetMode(frequencies[1]);
        });

        eventBus.subscribe("frequencyMarkerClick", (data) => {
            handleFrequencyChange({
                detail: data.frequency,
                markerclick: true,
            });
            frequency = (data.frequency / 1e3).toFixed(2);
            frequencyInputComponent.setFrequency(data.frequency);
            demodBandwidthPanel.SetMode(data.modulation);
        });

        eventBus.subscribe("passbandUpdate", () => {
            displayStackComponent.updatePassband();
        });

        eventBus.subscribe("linkUpdate", updateLink);
        
        // Handle waterfall range changes from mobile zoom slider
        eventBus.subscribe("waterfallRangeChanged", () => {
            displayStackComponent.updatePassband();
            frequencyMarkerComponent.updateFrequencyMarkerPositions();
        });
        
        // Mobile quick access events
        eventBus.subscribe("showBands", () => {
            showBandsMenu = true;
        });
        
        eventBus.subscribe("hideBands", () => {
            showBandsMenu = false;
        });
        
        eventBus.subscribe("showBookmarks", () => {
            showBookmarkDialog = true;
        });
        
        eventBus.subscribe("hideBookmarks", () => {
            showBookmarkDialog = false;
        });

        // Set middle column width
        const middleColumn = document.getElementById("middle-column");
        function setWidth() {
            document.documentElement.style.setProperty(
                "--middle-column-width",
                `1372px`,
            );
        }
        setWidth();
        window.addEventListener("resize", setWidth);

        return () => {
            window.removeEventListener("resize", setWidth);
        };
    });

    onDestroy(() => {
        clearInterval(updateInterval);
        audio.stop();
        waterfall.stop();
    });
</script>

<svelte:window
    on:mousemove={displayStackComponent?.handleWindowMouseMove}
    on:mouseup={displayStackComponent?.handleWindowMouseUp}
    on:keydown={(e) => {
        const activeElement = document.activeElement;
        const isInputFocused =
            activeElement &&
            (activeElement.tagName === "INPUT" ||
                activeElement.tagName === "TEXTAREA" ||
                activeElement.contentEditable === "true");

        // Special handling for frequency input - only allow Enter and Escape
        const isFrequencyInputFocused =
            activeElement instanceof HTMLInputElement &&
            activeElement.name === "frequency";

        // Don't process ANY shortcuts if typing in an input (except Enter/Escape for frequency input)
        if (
            isInputFocused &&
            !(isFrequencyInputFocused && ["Enter", "Escape"].includes(e.key))
        ) {
            return;
        }

        // Prevent default for certain keys
        if (
            [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                " ",
                "+",
                "-",
                "=",
            ].includes(e.key)
        ) {
            e.preventDefault();
        }

        // Switch VFO on 'V' key press
        if (e.key === "v" || e.key === "V") {
            switchVFO();
        }

        // Frequency control
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const delta = e.key === "ArrowUp" ? 1 : -1;
            const step = e.shiftKey ? 100 : 50;
            const currentFreqHz = parseFloat(frequency) * 1e3;
            const newFreqHz = currentFreqHz + delta * step;
            frequency = (newFreqHz / 1e3).toFixed(2);
            frequencyInputComponent.setFrequency(newFreqHz);
            handleFrequencyChange({ detail: newFreqHz });
        }

        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            const delta = e.key === "ArrowRight" ? 1 : -1;
            const step = e.shiftKey ? 10000 : 1000; // 10 kHz or 1 kHz
            const currentFreqHz = parseFloat(frequency) * 1e3;
            const newFreqHz = currentFreqHz + delta * step;
            frequency = (newFreqHz / 1e3).toFixed(2);
            frequencyInputComponent.setFrequency(newFreqHz);
            handleFrequencyChange({ detail: newFreqHz });
        }

        // Mode selection
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
            switch (e.key.toLowerCase()) {
                case "u":
                    demodulation = "USB";
                    demodBandwidthPanel?.SetMode("USB");
                    break;
                case "l":
                    demodulation = "LSB";
                    demodBandwidthPanel?.SetMode("LSB");
                    break;
                case "a":
                    // Toggle between AM and SAM
                    if (demodulation === "AM") {
                        demodulation = "SAM";
                        demodBandwidthPanel?.SetMode("SAM");
                    } else {
                        demodulation = "AM";
                        demodBandwidthPanel?.SetMode("AM");
                    }
                    break;
                case "f":
                    demodulation = "FM";
                    demodBandwidthPanel?.SetMode("FM");
                    break;
                case "c":
                    demodulation = "CW";
                    demodBandwidthPanel?.SetMode("CW");
                    break;
            }
        }

        // Waterfall zoom controls
        if (e.key === "+" || e.key === "=") {
            handleWaterfallMagnify(e, "+");
        }
        if (e.key === "-") {
            handleWaterfallMagnify(e, "-");
        }
        if (e.key === "0") {
            handleWaterfallMagnify(e, "max");
        }
        if (e.key === "9") {
            handleWaterfallMagnify(e, "min");
        }

        // Audio controls
        if (e.key === " ") {
            // Spacebar for mute
            audioPanel?.handleMuteChange();
        }
        if (e.key === "s" || e.key === "S") {
            audioPanel?.handleSquelchChange();
        }
        if (e.key === "r" || e.key === "R") {
            audioPanel?.handleRecordingChange();
        }

        // Other controls
        if (e.key === "b" || e.key === "B") {
            showBookmarkDialog = true;
        }
        if (e.key === "g" || e.key === "G") {
            showBandsMenu = true;
        }
        if (e.key === "n" || e.key === "N") {
            audioPanel?.handleNRChange();
        }
        if (e.key === "t" || e.key === "T") {
            audioPanel?.handleANChange();
        }

        // Show keybinds with '?'
        if (e.key === "?") {
            // We need to trigger the keybinds modal in ServerInfo component
            const keybindsBtn = document.querySelector(
                '[title="Keyboard Shortcuts"]',
            );
            if (keybindsBtn instanceof HTMLElement) {
                keybindsBtn.click();
            }
        }

        // ESC is now handled in individual components
    }}
/>

<main class="main-container">
    <div class="h-screen overflow-hidden flex flex-col min-h-screen">
        <div class="w-full flex-grow overflow-y-auto">
            <div class="app-content">
                <div class="content-inner">
                    <!-- Server Information -->
                    <div class="server-info-wrapper">
                        <ServerInfo currentFrequency={parseFloat(frequency) * 1e3} />
                    </div>

                    <TutorialOverlay
                        bind:showTutorial
                        onComplete={() => (showTutorial = false)}
                    />

                    <div class="display-stack-wrapper">
                        <DisplayStack
                            bind:this={displayStackComponent}
                            bind:frequencyInputComponent
                            bind:passbandTunerComponent
                            bind:frequencyMarkerComponent
                            on:change={handleFrequencyChange}
                        />
                    </div>

                    <AudioGateOverlay
                        visible={audioGateVisible}
                        onClick={handleAudioGateClick}
                    />

                    <!-- VFO Switch Notification -->
                    {#if vfoSwitchNotification}
                        <div
                            class="vfo-notification"
                            in:fly={{ y: -30, duration: 200, easing: quintOut }}
                            out:fade={{ duration: 150 }}
                        >
                            <div class="notification-content">
                                <div class="vfo-icon-wrapper">
                                    <svg
                                        width="20"
                                        height="20"
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="vfo-icon"
                                    >
                                        <path
                                            d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                                            fill="currentColor"
                                        />
                                    </svg>
                                </div>
                                <span class="notification-text"
                                    >{vfoSwitchNotification}</span
                                >
                            </div>
                        </div>
                    {/if}

                    <!-- Main panels -->
                    <div class="main-panels" id="middle-column">
                        <AudioPanel
                            bind:this={audioPanel}
                            currentFrequency={parseFloat(frequency) * 1e3}
                            on:stateChange={(e) => {
                                NREnabled = e.detail.NREnabled;
                                NBEnabled = e.detail.NBEnabled;
                                ANEnabled = e.detail.ANEnabled;
                                CTCSSSupressEnabled =
                                    e.detail.CTCSSSupressEnabled;
                                mute = e.detail.mute;
                            }}
                        />

                        <div class="center-panel">
                            <div class="frequency-display" id="smeter-tut">
                                <div class="frequency-panel">
                                    <div class="frequency-section">
                                        <input
                                            class="frequency-input"
                                            type="text"
                                            bind:value={frequency}
                                            size="3"
                                            name="frequency"
                                            on:keydown={(e) => {
                                                if (e.key === "Enter") {
                                                    const freqHz =
                                                        parseFloat(frequency) *
                                                        1e3;
                                                    frequencyInputComponent.setFrequency(
                                                        freqHz,
                                                    );
                                                    handleFrequencyChange({
                                                        detail: freqHz,
                                                    });
                                                }
                                            }}
                                            use:handleWheel
                                        />
                                        <div class="frequency-info">
                                            <span
                                                class="vfo-badge clickable"
                                                on:click={switchVFO}
                                                title="Click to switch VFO (or press V)"
                                            >VFO {currentVFO}</span>
                                            <span class="separator">•</span>
                                            <span class="mode-text"
                                                >{demodulation}</span
                                            >
                                            <span class="separator">•</span>
                                            <span class="bandwidth-text"
                                                >{bandwidth} kHz</span
                                            >
                                        </div>
                                    </div>

                                    <div class="status-section">
                                        <div class="status-indicators">
                                            {#each [{ label: "MUTED", enabled: mute, color: "red" }, { label: "NR", enabled: NREnabled, color: "green" }, { label: "NB", enabled: NBEnabled, color: "green" }, { label: "AN", enabled: ANEnabled, color: "green" }] as indicator}
                                                <div
                                                    class="status-indicator {indicator.enabled
                                                        ? `active ${indicator.color}`
                                                        : ''}"
                                                >
                                                    <span
                                                        >{indicator.label}</span
                                                    >
                                                </div>
                                            {/each}
                                        </div>
                                        <!-- SMeter -->
                                        <canvas
                                            id="sMeter"
                                            width="250"
                                            height="40"
                                        ></canvas>
                                    </div>
                                </div>
                            </div>

                            <DemodBandwidthPanel
                                bind:this={demodBandwidthPanel}
                                {frequencyInputComponent}
                                {passbandTunerComponent}
                                {demodulation}
                                on:modeChange={(e) => {
                                    demodulation = e.detail;
                                    // Directly call handleDemodulationChange after updating state
                                    tick().then(() => {
                                        demodBandwidthPanel.handleDemodulationChange(
                                            null,
                                            true,
                                        );
                                    });
                                }}
                            />

                            <!-- Zoom Controls and Misc Options -->
                            <div class="controls-grid">
                                <!-- Zoom Controls -->
                                <div class="control-section">
                                    <div class="section-header">
                                        <div class="accent-dot bg-purple"></div>
                                        <h3 class="section-label">Zoom</h3>
                                    </div>
                                    <div id="zoom-controls" class="button-grid">
                                        {#each [{ action: "+", title: "Zoom in", text: "+" }, { action: "-", title: "Zoom out", text: "-" }, { action: "max", title: "Zoom to max", text: "Max" }, { action: "min", title: "Zoom to min", text: "Min" }] as { action, title, text }}
                                            <button
                                                class="control-button"
                                                on:click={(e) =>
                                                    handleWaterfallMagnify(
                                                        e,
                                                        action,
                                                    )}
                                                {title}
                                            >
                                                {text}
                                            </button>
                                        {/each}
                                    </div>
                                </div>

                                <!-- Processing Options -->
                                <div class="control-section">
                                    <div class="section-header">
                                        <div class="accent-dot bg-orange"></div>
                                        <h3 class="section-label">
                                            Processing
                                        </h3>
                                    </div>
                                    <div id="moreoptions" class="button-grid">
                                        <button
                                            class="control-button {NREnabled
                                                ? 'active'
                                                : ''}"
                                            on:click={() =>
                                                audioPanel?.handleNRChange()}
                                            title="Noise Reduction"
                                        >
                                            {#if NREnabled}
                                                <div
                                                    class="active-indicator"
                                                ></div>
                                            {/if}
                                            NR
                                        </button>
                                        <button
                                            class="control-button {NBEnabled
                                                ? 'active'
                                                : ''}"
                                            on:click={() =>
                                                audioPanel?.handleNBChange()}
                                            title="Noise Blanker"
                                        >
                                            {#if NBEnabled}
                                                <div
                                                    class="active-indicator"
                                                ></div>
                                            {/if}
                                            NB
                                        </button>
                                        <button
                                            class="control-button {ANEnabled
                                                ? 'active'
                                                : ''}"
                                            on:click={() =>
                                                audioPanel?.handleANChange()}
                                            title="Auto Notch"
                                        >
                                            {#if ANEnabled}
                                                <div
                                                    class="active-indicator"
                                                ></div>
                                            {/if}
                                            AN
                                        </button>
                                        <button
                                            class="control-button {CTCSSSupressEnabled
                                                ? 'active'
                                                : ''}"
                                            on:click={() =>
                                                audioPanel?.handleCTCSSChange()}
                                            title="CTCSS Filter"
                                        >
                                            {#if CTCSSSupressEnabled}
                                                <div
                                                    class="active-indicator"
                                                ></div>
                                            {/if}
                                            CTCSS
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <WaterfallControls>
                            <div slot="extra-controls" class="extra-controls">
                                <!-- Bands and Bookmarks Row -->
                                <div class="action-buttons-grid">
                                    <!-- Bands Button -->
                                    <button
                                        id="bands-button"
                                        class="action-button"
                                        on:click={() => (showBandsMenu = true)}
                                    >
                                        <svg
                                            width="20"
                                            height="20"
                                            viewBox="0 0 20 20"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path
                                                d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"
                                                fill="currentColor"
                                            />
                                            <path
                                                fill-rule="evenodd"
                                                d="M4 5a2 2 0 012-2 1 1 0 000 2H6a2 2 0 00-2 2v6a2 2 0 002 2h2a1 1 0 100 2H6a4 4 0 01-4-4V5z"
                                                clip-rule="evenodd"
                                                fill="currentColor"
                                            />
                                            <path
                                                fill-rule="evenodd"
                                                d="M16 5a2 2 0 00-2-2 1 1 0 100 2h0a2 2 0 012 2v6a2 2 0 01-2 2h-2a1 1 0 100 2h2a4 4 0 004-4V5z"
                                                clip-rule="evenodd"
                                                fill="currentColor"
                                            />
                                        </svg>
                                        <span>Bands</span>
                                    </button>

                                    <!-- Bookmarks Button -->
                                    <button
                                        id="bookmark-button"
                                        class="action-button"
                                        on:click={() =>
                                            (showBookmarkDialog = true)}
                                    >
                                        <svg
                                            width="20"
                                            height="20"
                                            viewBox="0 0 20 20"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path
                                                d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z"
                                                fill="currentColor"
                                            />
                                        </svg>
                                        <span>Bookmarks</span>
                                    </button>
                                </div>

                                <!-- User Count -->
                                <div
                                    id="user_count_container"
                                    class="user-count-container"
                                >
                                    <div
                                        id="total_user_count"
                                        class="user-count-content"
                                    >
                                        <div class="user-count-header">
                                            <svg
                                                width="16"
                                                height="16"
                                                viewBox="0 0 16 16"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <circle
                                                    cx="8"
                                                    cy="5"
                                                    r="2.5"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                />
                                                <path
                                                    d="M3 14c0-2.761 2.239-5 5-5s5 2.239 5 5"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    stroke-linecap="round"
                                                />
                                                <circle
                                                    cx="12.5"
                                                    cy="4.5"
                                                    r="1.5"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                />
                                                <path
                                                    d="M14 12c0-1.657-1.343-3-3-3"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    stroke-linecap="round"
                                                />
                                                <circle
                                                    cx="3.5"
                                                    cy="4.5"
                                                    r="1.5"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                />
                                                <path
                                                    d="M2 12c0-1.657 1.343-3 3-3"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    stroke-linecap="round"
                                                />
                                            </svg>
                                            <span>Active Users</span>
                                        </div>
                                        <div class="divider"></div>
                                        <!-- Content will be populated by JavaScript but will have a horizontal layout -->
                                    </div>
                                </div>
                            </div>
                        </WaterfallControls>
                    </div>

                    <BookmarkDialog
                        bind:showDialog={showBookmarkDialog}
                        currentFrequency={parseFloat(frequency) * 1e3}
                        {demodulation}
                        {link}
                    />

                    <BandsMenu bind:showBandsMenu />
                    {#if $serverInfo.chatEnabled}
                    <div class="chat-wrapper" id="chat-column">
                        <ChatPanel
                            currentFrequency={parseFloat(frequency) * 1e3}
                            {demodulation}
                        />
                    </div>
                    {/if}
                </div>
                <AppFooter version={VERSION} />
                <MobileBottomBar bind:this={mobileBottomBar} />
            </div>
        </div>
    </div>
</main>

<svelte:head>
    <link
        href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
        rel="stylesheet"
    />
    <link
        href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap"
        rel="stylesheet"
    />
</svelte:head>

<style>
    /* Main Container */
    .main-container {
        text-align: center;
        margin: 0 auto;
    }

    .chat-wrapper {
        display: flex;
        flex-direction: column;
    }

    .h-screen {
        height: 100vh;
    }

    .overflow-hidden {
        overflow: hidden;
    }

    .flex {
        display: flex;
    }

    .flex-col {
        flex-direction: column;
    }

    .min-h-screen {
        min-height: 100vh;
    }

    .w-full {
        width: 100%;
    }

    .flex-grow {
        flex-grow: 1;
    }

    .overflow-y-auto {
        overflow-y: auto;
    }

    .app-content {
        background: rgba(28, 28, 30, 0.95);
        color: #e5e5e7;
        padding-top: 10px;
    }
    
    /* Remove dimming only when background image is loaded */
    :global(body.background-loaded) .app-content {
        background: transparent;
    }

    .content-inner {
        max-width: 1200px;
        margin: 0 auto;
    }

    /* Component Wrappers */
    .server-info-wrapper,
    .display-stack-wrapper {
        display: flex;
        justify-content: center;
        width: 100%;
    }

    /* Main Panels */
    .main-panels {
        display: flex;
        flex-direction: column;
        padding: 1.25rem;
        justify-content: center;
        border-radius: 0.25rem;
        width: 100%;
    }

    @media (min-width: 1280px) {
        .main-panels {
            flex-direction: row;
            justify-content: center;
            align-items: stretch;
            gap: 0;
        }
    }

    /* Center Panel */
    .center-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: #1c1c1e;
        padding: 0.75rem 1.5rem;
        border-left: 0;
        border-right: 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        width: 100%;
        min-height: 100%;
    }

    /* Frequency Display */
    .frequency-display {
        background: #000000;
        border-radius: 0.5rem;
        padding: 2rem;
        min-width: 20rem;
        margin-bottom: 0.5rem;
        width: 100%;
    }

    @media (min-width: 1024px) {
        .frequency-display {
            padding: 1rem;
        }
    }

    .frequency-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    @media (min-width: 640px) {
        .frequency-panel {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
        }
    }

    .frequency-section {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .frequency-input {
        font-size: 2.5rem;
        line-height: 1;
        height: 3.5rem;
        width: 11rem;
        text-align: center;
        background: transparent;
        color: #0fb7e6;
        border: none;
        outline: none;
        font-weight: 300;
        font-family: "SF Mono", monospace;
        letter-spacing: -0.02em;
        margin-bottom: 0.5rem;
        transition: all 0.15s ease;
    }

    .frequency-input:focus {
        color: #0fc9ff;
        text-shadow: 0 0 20px rgba(15, 201, 255, 0.5);
    }

    .frequency-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
    }

    .vfo-badge {
        color: #0071e3;
        font-weight: 600;
        padding: 0.125rem 0.375rem;
        background: rgba(0, 113, 227, 0.2);
        border-radius: 0.25rem;
        transition: all 0.15s ease;
        display: inline-block;
        white-space: nowrap;
    }

    .vfo-badge.clickable {
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
    }

    .vfo-badge.clickable:hover {
        background: rgba(0, 113, 227, 0.3);
        transform: scale(1.05);
    }

    .vfo-badge.clickable:active {
        transform: scale(0.95);
        background: rgba(0, 113, 227, 0.4);
    }

    /* Mobile-specific styles */
    @media (max-width: 768px) {
        .vfo-badge.clickable {
            padding: 0.25rem 0.5rem;
            font-size: 0.875rem;
            border: 1px solid rgba(0, 113, 227, 0.3);
        }

        .vfo-badge.clickable:hover {
            background: rgba(0, 113, 227, 0.3);
            border-color: rgba(0, 113, 227, 0.5);
        }
        
        /* Add padding for mobile bottom bar */
        .flex.flex-col {
            padding-bottom: 4.5rem; /* Space for bottom bar */
        }

        .vfo-badge.clickable:active {
            background: rgba(0, 113, 227, 0.5);
            border-color: rgba(0, 113, 227, 0.7);
        }
    }

    .separator {
        color: #48484a;
    }

    .mode-text {
        color: #32d74b;
        font-weight: 500;
    }

    .bandwidth-text {
        color: #0fb7e6;
        font-weight: 500;
    }

    /* Status Section */
    .status-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
    }

    .status-indicators {
        display: flex;
        gap: 0.5rem;
    }

    .status-indicator {
        padding: 0.125rem 0.5rem;
        height: 1.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 3rem;
        position: relative;
        overflow: hidden;
    }

    .status-indicator span {
        font-size: 0.75rem;
        font-family: "SF Mono", monospace;
        color: #48484a;
        font-weight: 500;
        position: relative;
        z-index: 10;
        transition: color 0.15s ease;
    }

    .status-indicator.active span {
        color: #f5f5f7;
    }

    .status-indicator.active.red span {
        color: #ff3b30;
    }

    .status-indicator.active.green span {
        color: #32d74b;
    }

    /* S-Meter */
    #sMeter {
        width: 300px;
        height: 40px;
        background-color: transparent;
        display: block;
        margin-left: 30px;
        margin-top: 5px;
    }

    /* Controls Grid */
    .controls-grid {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
    }

    @media (max-width: 640px) {
        .controls-grid {
            grid-template-columns: 1fr;
        }
    }

    /* Control Sections */
    .control-section {
        background: rgba(255, 255, 255, 0.04);
        border-radius: 0.625rem;
        padding: 0.75rem;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.06);
    }

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

    .bg-purple {
        background: #af52de;
    }

    .bg-orange {
        background: #ff9500;
    }

    .section-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: #e5e5e7;
    }

    .button-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
    }

    .control-button {
        position: relative;
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

    .control-button:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.12);
        transform: scale(1.02);
    }

    .control-button:active {
        transform: scale(0.98);
    }

    .control-button.active {
        background: #32d74b;
        color: white;
        border-color: #32d74b;
        box-shadow: 0 2px 8px rgba(50, 215, 75, 0.3);
    }

    .control-button.active:hover {
        background: #3ae052;
        border-color: #3ae052;
    }

    .active-indicator {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 6px;
        height: 6px;
        background: #32d74b;
        border-radius: 50%;
        box-shadow: 0 0 6px rgba(50, 215, 75, 0.6);
    }

    /* Extra Controls */
    .extra-controls {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .action-buttons-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
    }

    .action-button {
        background: rgba(255, 255, 255, 0.04);
        border-radius: 0.625rem;
        padding: 1rem;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .action-button:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.08);
        transform: scale(1.02);
    }

    .action-button svg {
        width: 20px;
        height: 20px;
        color: #32d74b;
        transition: color 0.15s ease;
    }

    #bookmark-button svg {
        color: #ffd60a;
    }

    .action-button span {
        color: #e5e5e7;
        font-weight: 500;
        font-size: 0.875rem;
        transition: color 0.15s ease;
    }

    .action-button:hover span {
        color: #f5f5f7;
    }

    /* User Count */
    .user-count-container {
        width: 100%;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 0.625rem;
        padding: 0.5rem 1rem;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .user-count-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.875rem;
    }

    .user-count-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .user-count-header svg {
        width: 16px;
        height: 16px;
        color: #0071e3;
    }

    .user-count-header span {
        color: #a1a1a6;
        font-weight: 500;
    }

    .divider {
        width: 1px;
        height: 1rem;
        background: rgba(255, 255, 255, 0.1);
        margin: 0 0.75rem;
    }

    /* VFO Notification */
    .vfo-notification {
        position: fixed;
        top: 2rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        animation: slideDown 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: linear-gradient(135deg, #0071e3 0%, #0077ed 100%);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 9999px;
        box-shadow:
            0 10px 25px rgba(0, 113, 227, 0.3),
            0 20px 40px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
        font-weight: 600;
        font-size: 0.9375rem;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        position: relative;
        overflow: hidden;
    }
    .notification-content::before {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.3),
            transparent
        );
        animation: shimmer 0.8s ease-in-out;
    }
    .vfo-icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        position: relative;
    }
    .vfo-icon {
        animation: rotate 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    }

    @keyframes rotate {
        0% {
            transform: rotate(0deg) scale(0.8);
        }
        100% {
            transform: rotate(360deg) scale(1);
        }
    }

    .notification-text {
        position: relative;
        z-index: 1;
    }

    @keyframes slideDown {
        0% {
            transform: translateX(-50%) translateY(-100px);
            opacity: 0;
        }
        100% {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
    }

    @keyframes rotate {
        0% {
            transform: rotate(0deg);
        }
        100% {
            transform: rotate(360deg);
        }
    }

    @keyframes shimmer {
        0% {
            left: -100%;
        }
        100% {
            left: 100%;
        }
    }

    @keyframes fadeOut {
        0% {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        100% {
            transform: translateX(-50%) translateY(-20px);
            opacity: 0;
        }
    }

    @media (min-width: 1372px) {
        #chat-box {
            min-width: var(--middle-column-width);
        }
        #chat-column {
            align-items: center;
        }
    }

    @media screen and (min-width: 1372px) {
        #outer-waterfall-container {
            min-width: 1372px;
        }
    }

    /* Global Styles */
    :global(body) {
        font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
            Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        background-color: #000000;
        background-image:
            url("/assets/background.jpg"), url("/assets/background.png");
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-attachment: fixed;
        margin: 0;
        padding: 0;
        min-height: 100vh;
    }

    :global(#app) {
        width: 100%;
    }

    :global(body.light-mode) {
        background-color: #a9a9a9;
        transition: background-color 0.3s;
    }

    :global(:focus-visible) {
        outline: 2px solid rgba(0, 113, 227, 0.5);
        outline-offset: 2px;
        border-radius: 0.25rem;
    }
</style>
