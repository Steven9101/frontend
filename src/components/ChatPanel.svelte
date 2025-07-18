<script>
  import { writable } from 'svelte/store';
  import { onMount, onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { eventBus } from '../eventBus';

  // Props
  export let currentFrequency = 0;
  export let demodulation = 'USB';

  // Local state
  let messages = writable([]);
  let newMessage = "";
  let socket;
  let username = `user${Math.floor(Math.random() * 10000)}`;
  let showUsernameInput = false;
  let chatMessages;
  let isConnected = false;
  let currentUserId = null;
  let replyingTo = null;

  function saveUsername() {
    localStorage.setItem('chatusername', username);
    showUsernameInput = false;
  }

  function editUsername() {
    showUsernameInput = true;
  }

  function sendMessage() {
    if (newMessage.trim() && username.trim() && socket && socket.readyState === WebSocket.OPEN) {
      const messageObject = {
        cmd: "chat",
        message: newMessage.trim(),
        username: username,
        user_id: currentUserId
      };
      
      // Add reply information if replying
      if (replyingTo) {
        messageObject.reply_to_id = replyingTo.id;
        messageObject.reply_to_username = replyingTo.username;
      }
      
      try {
        socket.send(JSON.stringify(messageObject));
        newMessage = "";
        replyingTo = null;
        scrollToBottom();
      } catch (error) {
        console.error('Failed to send message:', error);
      }
    }
  }

  function handleEnterKey(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  }

  function pasteFrequency() {
    const frequencyText = `[FREQ:${Math.round(currentFrequency)}:${demodulation}]`;
    newMessage = newMessage + " " + frequencyText;
  }

  function shareFrequency() {
    const shareMessage = `[FREQ:${Math.round(currentFrequency)}:${demodulation}] Check out this frequency!`;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const messageObject = {
        cmd: "chat",
        message: shareMessage,
        username: username,
        user_id: currentUserId
      };
      try {
        socket.send(JSON.stringify(messageObject));
        scrollToBottom();
      } catch (error) {
        console.error('Failed to share frequency:', error);
      }
    }
  }

  function scrollToBottom() {
    if (chatMessages) {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  function handleFrequencyClick(frequency, mode) {
    eventBus.publish('frequencyChange', { detail: frequency });
    eventBus.publish('setMode', mode);
  }

  function replyToMessage(messageObj) {
    replyingTo = {
      id: messageObj.id,
      username: messageObj.username || extractUsernameFromText(messageObj.text),
      message: messageObj.message || extractMessageFromText(messageObj.text)
    };
  }

  function cancelReply() {
    replyingTo = null;
  }

  function extractUsernameFromText(text) {
    const regex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+?): (.+)$/;
    const match = text.match(regex);
    return match ? match[2] : 'Unknown';
  }

  function extractMessageFromText(text) {
    const regex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+?): (.+)$/;
    const match = text.match(regex);
    return match ? match[3] : text;
  }

  function formatMessage(text) {
    const now = new Date();
    return `${username}: ${text.substring(0, 500)}`;
  }

  function handleInvalidMessage(data) {
    console.warn('Received invalid message format, ignoring:', data);
    // Simply ignore invalid messages to prevent crashes
  }

  function formatFrequencyMessage(messageObj) {
    // Handle new message format only
    if (messageObj.username && messageObj.message && messageObj.timestamp) {
      const freqRegex = /\[FREQ:(\d+):([\w-]+)\]/;
      const freqMatch = messageObj.message.match(freqRegex);
      if (freqMatch) {
        const [fullMatch, frequency, demodulation] = freqMatch;
        const [beforeFreq, afterFreq] = messageObj.message.split(fullMatch).map(part => formatLinks(sanitizeHtml(part)));
        return {
          isFormatted: true,
          timestamp: sanitizeHtml(messageObj.timestamp),
          username: sanitizeHtml(messageObj.username),
          frequency: parseInt(frequency, 10),
          demodulation: sanitizeHtml(demodulation),
          beforeFreq,
          afterFreq,
          hasReply: messageObj.reply_to_id && messageObj.reply_to_id !== '',
          replyToUsername: messageObj.reply_to_username || ''
        };
      }
      return {
        isFormatted: false,
        timestamp: sanitizeHtml(messageObj.timestamp),
        username: sanitizeHtml(messageObj.username),
        parts: formatLinks(sanitizeHtml(messageObj.message)),
        hasReply: messageObj.reply_to_id && messageObj.reply_to_id !== '',
        replyToUsername: messageObj.reply_to_username || ''
      };
    }
    
    // Fallback for malformed data
    return {
      isFormatted: false,
      timestamp: 'Unknown',
      username: 'Unknown',
      parts: [{type: 'text', content: 'Invalid message'}],
      hasReply: false,
      replyToUsername: ''
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
        return `<a href="${sanitizeHtml(part.url)}" target="_blank" rel="noopener noreferrer" class="link">${sanitizeHtml(part.content)}</a>`;
      }
      return part.content;
    }).join('');
  }

  function sanitizeHtml(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }

  function initWebSocket() {
    username = localStorage.getItem('chatusername') || '';
    if (!username) {
      console.log("No Username. Setting a random username.");
      username = `user${Math.floor(Math.random() * 10000)}`;
    }
    showUsernameInput = !username;

    try {
      socket = new WebSocket(
        window.location.origin.replace(/^http/, "ws") + "/chat"
      );

      socket.onopen = () => {
        console.log('Chat WebSocket connected');
        isConnected = true;
        // Generate a unique user ID for this session
        currentUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      };

      socket.onclose = () => {
        console.log('Chat WebSocket disconnected');
        isConnected = false;
        // Try to reconnect after 3 seconds
        setTimeout(() => {
          if (!socket || socket.readyState === WebSocket.CLOSED) {
            initWebSocket();
          }
        }, 3000);
      };

      socket.onerror = (error) => {
        console.error('Chat WebSocket error:', error);
        isConnected = false;
      };

      socket.onmessage = (event) => {
        try {
          let messageData;
          
          // Try to parse as JSON
          try {
            messageData = JSON.parse(event.data);
          } catch (jsonError) {
            // Invalid format - ignore to prevent crashes
            handleInvalidMessage(event.data);
            return;
          }
          
          if (messageData.type === "history") {
            // Handle history message
            if (messageData.messages && Array.isArray(messageData.messages)) {
              const historyMessages = messageData.messages.map((msg, index) => ({
                id: msg.id || (Date.now() + index),
                username: msg.username,
                message: msg.message,
                timestamp: msg.timestamp,
                user_id: msg.user_id,
                type: msg.type,
                reply_to_id: msg.reply_to_id || '',
                reply_to_username: msg.reply_to_username || '',
                isCurrentUser: msg.user_id === currentUserId
              }));
              messages.set(historyMessages);
            }
          } else if (messageData.id && messageData.username && messageData.message) {
            // Handle new message
            const newMessageObj = {
              id: messageData.id,
              username: messageData.username,
              message: messageData.message,
              timestamp: messageData.timestamp,
              user_id: messageData.user_id,
              type: messageData.type,
              reply_to_id: messageData.reply_to_id || '',
              reply_to_username: messageData.reply_to_username || '',
              isCurrentUser: messageData.user_id === currentUserId
            };
            
            messages.update((currentMessages) => [
              ...currentMessages,
              newMessageObj,
            ]);
          } else {
            // Invalid message structure - ignore
            handleInvalidMessage(JSON.stringify(messageData));
          }
          
          scrollToBottom();
        } catch (error) {
          console.error('Error processing message:', error);
          handleInvalidMessage(event.data);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      isConnected = false;
    }
  }

  onMount(() => {
    username = localStorage.getItem('chatusername') || '';
    if (!username) {
      console.log("No Username. Setting a random username.");
      username = `user${Math.floor(Math.random() * 10000)}`;
    }
    showUsernameInput = !username;
    initWebSocket();
  });

  onDestroy(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  });

  $: {
    if ($messages) {
      setTimeout(scrollToBottom, 100);
    }
  }
</script>

<div class="chat-container" id="chat-box">
  <div class="chat-header">
    <h2 class="chat-title">Chat</h2>
  </div>

  <div class="chat-body">
    <!-- Username Display/Input -->
    <div class="username-section">
      <div class="section-header">
        <div class="accent-dot bg-indigo"></div>
        <h3 class="section-label">Username</h3>
      </div>
      <div class="username-controls">
        {#if showUsernameInput}
          <input
            class="text-input"
            bind:value={username}
            placeholder="Enter your name/callsign"
            on:keydown={(e) => e.key === 'Enter' && saveUsername()}
          />
          <button
            class="primary-button"
            on:click={saveUsername}
          >
            Save
          </button>
        {:else}
          <div class="username-display">
            <span class="username-label">Chatting as:</span>
            <span class="username-badge">
              {username || 'Anonymous'}
            </span>
            <button
              class="secondary-button"
              on:click={editUsername}
            >
              Edit
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Chat Messages -->
    <div class="messages-container">
      <div class="messages-scroll" bind:this={chatMessages}>
        {#if $messages.length === 0}
          <div class="empty-state">
            <p>No messages yet. Start a conversation!</p>
          </div>
        {/if}
        {#each $messages as messageObj (messageObj.id)}
          {@const formattedMessage = formatFrequencyMessage(messageObj)}
          <div class="message-wrapper {messageObj.isCurrentUser ? 'own-message' : ''}"
               in:fly={{ x: messageObj.isCurrentUser ? 20 : -20, duration: 200, easing: quintOut }}>
            <div class="message-bubble">
              <div class="message-header">
                <span class="message-username">
                  {formattedMessage.username || 'Unknown'}
                </span>
                <span class="message-timestamp">{formattedMessage.timestamp || ''}</span>
                {#if !messageObj.isCurrentUser}
                  <button
                    class="reply-button"
                    on:click={() => replyToMessage(messageObj)}
                    title="Reply to this message"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 6l3-3v2h4v2H6v2L3 6z" fill="currentColor"/>
                    </svg>
                  </button>
                {/if}
              </div>
              
              {#if formattedMessage.hasReply}
                <div class="reply-indicator">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 6l3-3v2h4v2H6v2L3 6z" fill="currentColor"/>
                  </svg>
                  Replying to <span class="reply-username">{formattedMessage.replyToUsername}</span>
                </div>
              {/if}
              
              <p class="message-content">
                {#if formattedMessage.isFormatted}
                  {@html renderParts(formattedMessage.beforeFreq)}
                  <button
                    class="frequency-button"
                    on:click={() => handleFrequencyClick(formattedMessage.frequency, formattedMessage.demodulation)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 1l-5 7h3v3l5-7H7V1z" fill="currentColor"/>
                    </svg>
                    {(formattedMessage.frequency / 1000).toFixed(3)} kHz • {formattedMessage.demodulation}
                  </button>
                  {@html renderParts(formattedMessage.afterFreq)}
                {:else}
                  {@html renderParts(formattedMessage.parts)}
                {/if}
              </p>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Message Input and Buttons -->
    <div class="input-section">
      {#if replyingTo}
        <div class="reply-preview">
          <div class="reply-preview-content">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 6l3-3v2h4v2H6v2L3 6z" fill="currentColor"/>
            </svg>
            <span>Replying to <strong>{replyingTo.username}</strong>: {replyingTo.message.substring(0, 50)}{replyingTo.message.length > 50 ? '...' : ''}</span>
          </div>
          <button class="cancel-reply-button" on:click={cancelReply} title="Cancel reply">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>
      {/if}
      <div class="input-row">
        <input
          class="message-input"
          bind:value={newMessage}
          on:keydown={handleEnterKey}
          placeholder={replyingTo ? `Reply to ${replyingTo.username}...` : "Type a message..."}
        />
        <div class="button-group">
          <button
            class="send-button"
            on:click={sendMessage}
            disabled={!newMessage.trim() || !username.trim()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 8l12-6v12L2 8z" fill="currentColor"/>
            </svg>
            Send
          </button>
          <button
            class="freq-button"
            on:click={pasteFrequency}
            title="Insert current frequency"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 1L4 8h3v7l5-7h-3V1z" fill="currentColor"/>
            </svg>
            <span class="freq-button-text">Insert Freq</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Container */
  .chat-container {
    display: flex;
    flex-direction: column;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    width: 100%;
    margin-bottom: 2rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  
  /* Header */
  .chat-header {
    padding: 1.5rem;
  }
  
  .chat-title {
    font-size: 1.375rem;
    font-weight: 600;
    color: #f5f5f7;
    letter-spacing: -0.01em;
  }
  
  /* Body */
  .chat-body {
    padding: 0 1.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    flex-grow: 1;
  }
  
  /* Username Section */
  .username-section {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 1rem;
  }
  
  .section-header {
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
  
  .bg-indigo {
    background: #5856d6;
  }
  
  .section-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
  }
  
  .username-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  
  .username-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-grow: 1;
  }
  
  .username-label {
    font-size: 0.875rem;
    color: #a1a1a6;
  }
  
  .username-badge {
    padding: 0.25rem 0.75rem;
    background: rgba(88, 86, 214, 0.1);
    color: #5856d6;
    border-radius: 0.5rem;
    font-weight: 500;
    font-size: 0.875rem;
    border: 1px solid rgba(88, 86, 214, 0.2);
  }
  
  /* Messages */
  .messages-container {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 1rem;
    flex-grow: 1;
    overflow: hidden;
  }
  
  .messages-scroll {
    padding: 1rem;
    height: 16rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  @media (min-width: 640px) {
    .messages-scroll {
      height: 20rem;
    }
  }
  
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #6e6e73;
    font-size: 0.875rem;
  }
  
  .message-wrapper {
    margin-bottom: 0.75rem;
    display: flex;
  }
  
  .message-wrapper.own-message {
    justify-content: flex-end;
  }
  
  .message-bubble {
    display: inline-block;
    max-width: 85%;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 0.75rem;
    padding: 0.625rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  
  .own-message .message-bubble {
    background: rgba(88, 86, 214, 0.1);
    border-color: rgba(88, 86, 214, 0.2);
  }
  
  .message-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  
  .message-username {
    font-weight: 600;
    font-size: 0.875rem;
    color: #0071e3;
  }
  
  .own-message .message-username {
    color: #5856d6;
  }
  
  .message-timestamp {
    font-size: 0.75rem;
    color: #6e6e73;
  }
  
  .message-content {
    font-size: 0.875rem;
    color: #e5e5e7;
    word-wrap: break-word;
  }
  
  :global(.link) {
    color: #0071e3;
    text-decoration: none;
  }
  
  :global(.link:hover) {
    text-decoration: underline;
  }
  
  .frequency-button {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: 0.375rem;
    background: rgba(0, 113, 227, 0.1);
    color: #0071e3;
    border: 1px solid rgba(0, 113, 227, 0.2);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .frequency-button:hover {
    background: rgba(0, 113, 227, 0.15);
    border-color: rgba(0, 113, 227, 0.3);
  }

  /* Reply functionality */
  .reply-button {
    background: none;
    border: none;
    color: #6e6e73;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 0.25rem;
    margin-left: 0.5rem;
    transition: all 0.15s ease;
    opacity: 0;
  }

  .message-wrapper:hover .reply-button {
    opacity: 1;
  }

  .reply-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e5e5e7;
  }

  .reply-indicator {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: #6e6e73;
    margin-bottom: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.375rem;
    border-left: 3px solid #0071e3;
  }

  .reply-username {
    color: #0071e3;
    font-weight: 500;
  }

  .reply-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(0, 113, 227, 0.1);
    border: 1px solid rgba(0, 113, 227, 0.2);
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
  }

  .reply-preview-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #0071e3;
    flex-grow: 1;
  }

  .cancel-reply-button {
    background: none;
    border: none;
    color: #6e6e73;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 0.25rem;
    transition: all 0.15s ease;
  }

  .cancel-reply-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #e5e5e7;
  }
  
  /* Input Section */
  .input-section {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  .input-row {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  @media (min-width: 640px) {
    .input-row {
      flex-direction: row;
    }
  }
  
  /* Inputs */
  .text-input,
  .message-input {
    flex-grow: 1;
    padding: 0.625rem 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    color: #e5e5e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    outline: none;
    transition: all 0.15s ease;
  }
  
  .text-input:focus,
  .message-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #0071e3;
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2);
  }
  
  .text-input::placeholder,
  .message-input::placeholder {
    color: #6e6e73;
  }
  
  /* Buttons */
  .button-group {
    display: flex;
    gap: 0.5rem;
  }
  
  .primary-button,
  .send-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: #0071e3;
    color: white;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  
  .primary-button:hover,
  .send-button:hover {
    background: #0077ed;
    transform: scale(1.02);
  }
  
  .primary-button:active,
  .send-button:active {
    background: #006edb;
  }
  
  .send-button:disabled {
    background: #2c2c2e;
    color: #6e6e73;
    cursor: not-allowed;
    transform: none;
  }
  
  .secondary-button,
  .freq-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: rgba(255, 255, 255, 0.08);
    color: #e5e5e7;
    font-weight: 500;
    font-size: 0.875rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  
  .secondary-button {
    margin-left: auto;
    padding: 0.375rem 0.75rem;
  }
  
  .secondary-button:hover,
  .freq-button:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.16);
    transform: scale(1.02);
  }
  
  .freq-button-text {
    display: none;
  }
  
  @media (min-width: 640px) {
    .freq-button-text {
      display: inline;
    }
  }
  
  /* Scrollbar */
  .messages-scroll::-webkit-scrollbar {
    width: 8px;
  }
  
  .messages-scroll::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
  }
  
  .messages-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
  
  .messages-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  
  /* Min width for large screens */
  @media screen and (min-width: 1372px) {
    #chat-box {
      min-width: var(--middle-column-width);
    }
  }
</style>