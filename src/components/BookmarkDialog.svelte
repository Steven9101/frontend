<script>
  import { writable } from 'svelte/store';
  import { onMount } from 'svelte';
  import copy from 'copy-to-clipboard';
  import { eventBus } from '../eventBus';
  import { fade, fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  // Props
  export let currentFrequency = 0;
  export let demodulation = 'USB';
  export let link = '';
  export let showDialog = false;

  // Local state
  let bookmarks = writable([]);
  let newBookmarkName = "";
  let importFileInput;

  function addBookmark() {
    if (!newBookmarkName.trim()) return;
    
    const bookmark = {
      name: newBookmarkName.trim(),
      link: link,
      frequency: currentFrequency,
      demodulation: demodulation,
    };
    bookmarks.update((currentBookmarks) => {
      const updatedBookmarks = [...currentBookmarks, bookmark];
      localStorage.setItem("bookmarks", JSON.stringify(updatedBookmarks));
      return updatedBookmarks;
    });
    newBookmarkName = "";
  }

  function goToBookmark(bookmark) {
    // Dispatch events to parent
    eventBus.publish('frequencyChange', { detail: bookmark.frequency });
    eventBus.publish('setMode', bookmark.demodulation);
    
    // Close dialog
    showDialog = false;
  }

  function copyToClipboard(text) {
    copy(text);
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

  function exportBookmarks() {
    const bookmarksData = JSON.stringify($bookmarks, null, 2);
    const blob = new Blob([bookmarksData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookmarks.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importBookmarks(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target.result;
        if (typeof result === 'string') {
          const importedBookmarks = JSON.parse(result);
          if (Array.isArray(importedBookmarks)) {
            // Merge with existing bookmarks
            bookmarks.update(currentBookmarks => {
              const mergedBookmarks = [...currentBookmarks, ...importedBookmarks];
              saveBookmarks(mergedBookmarks);
              return mergedBookmarks;
            });
          }
        }
      } catch (error) {
        alert('Invalid bookmark file format');
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    event.target.value = '';
  }

  function triggerImport() {
    if (importFileInput) {
      importFileInput.click();
    }
  }

  function toggleDialog() {
    showDialog = !showDialog;
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape' && showDialog) {
      showDialog = false;
    }
  }

  onMount(() => {
    const storedBookmarks = localStorage.getItem("bookmarks");
    if (storedBookmarks) {
      bookmarks.set(JSON.parse(storedBookmarks));
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Bookmark Dialog -->
{#if showDialog}
  <div class="dialog-container">
    <!-- Backdrop -->
    <div
      class="dialog-backdrop"
      transition:fade={{ duration: 150 }}
      on:click|self={toggleDialog}
    ></div>
    
    <!-- Dialog Content -->
    <div
      class="dialog-content"
      transition:scale={{ duration: 200, easing: quintOut, start: 0.95 }}
    >
      <!-- Header -->
      <div class="dialog-header">
        <h2 class="dialog-title">Bookmarks</h2>
        <button
          class="close-button"
          on:click={toggleDialog}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- Add Bookmark Section -->
        <div class="section-card">
          <div class="section-header">
            <div class="accent-dot bg-yellow-500"></div>
            <h3 class="section-title">Add New Bookmark</h3>
          </div>
          <div class="input-group">
            <input
              class="text-input"
              bind:value={newBookmarkName}
              placeholder="Enter bookmark name..."
              on:keydown={(e) => e.key === 'Enter' && addBookmark()}
            />
            <button
              class="primary-button"
              on:click={addBookmark}
              disabled={!newBookmarkName.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Add
            </button>
          </div>
        </div>

        <!-- Current Link Section -->
        <div class="section-card">
          <div class="section-header">
            <div class="accent-dot bg-blue-500"></div>
            <h3 class="section-title">Current Link</h3>
          </div>
          <div class="input-group">
            <input
              type="text"
              class="text-input readonly"
              value={link}
              readonly
            />
            <button
              class="secondary-button"
              on:click={() => copyToClipboard(link)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="5" y="5" width="8" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
                <path d="M11 3V2C11 1.44772 10.5523 1 10 1H4C3.44772 1 3 1.44772 3 2V10C3 10.5523 3.44772 11 4 11H5" stroke="currentColor" stroke-width="1.5"/>
              </svg>
              Copy
            </button>
          </div>
        </div>

        <!-- Import/Export Section -->
        <div class="section-card">
          <div class="section-header">
            <div class="accent-dot bg-purple-500"></div>
            <h3 class="section-title">Import/Export</h3>
          </div>
          <div class="input-group">
            <button
              class="secondary-button"
              on:click={triggerImport}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1V11M8 11L4 7M8 11L12 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 13H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Import
            </button>
            <button
              class="secondary-button"
              on:click={exportBookmarks}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 11V1M8 1L4 5M8 1L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 13H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Export
            </button>
          </div>
        </div>

        <!-- Bookmarks List -->
        <div class="section-card">
          <div class="section-header">
            <div class="accent-dot bg-green-500"></div>
            <h3 class="section-title">Saved Bookmarks</h3>
          </div>
          <div class="bookmarks-list">
            {#if $bookmarks.length === 0}
              <p class="empty-state">No bookmarks saved yet</p>
            {:else}
              {#each $bookmarks as bookmark, index (bookmark.link + index)}
                <div
                  class="bookmark-item"
                  transition:fly={{ x: -20, duration: 200, delay: index * 30 }}
                >
                  <div class="bookmark-info">
                    <span class="bookmark-name">{bookmark.name}</span>
                    <span class="bookmark-details">
                      {(bookmark.frequency / 1000).toFixed(3)} kHz • {bookmark.demodulation}
                    </span>
                  </div>
                  <div class="bookmark-actions">
                    <button
                      class="action-button go"
                      on:click={() => goToBookmark(bookmark)}
                      title="Go to frequency"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 7H13M13 7L8 2M13 7L8 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </button>
                    <button
                      class="action-button copy"
                      on:click={() => copyToClipboard(bookmark.link)}
                      title="Copy link"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="4" y="4" width="7" height="9" rx="1" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M10 2.5V2C10 1.44772 9.55228 1 9 1H3C2.44772 1 2 1.44772 2 2V8C2 8.55228 2.44772 9 3 9H3.5" stroke="currentColor" stroke-width="1.5"/>
                      </svg>
                    </button>
                    <button
                      class="action-button delete"
                      on:click={() => deleteBookmark(index)}
                      title="Delete bookmark"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 4H12M5 4V2.5C5 1.67157 5.67157 1 6.5 1H7.5C8.32843 1 9 1.67157 9 2.5V4M6 7V10M8 7V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        <path d="M3 4L4 12C4 12.5523 4.44772 13 5 13H9C9.55228 13 10 12.5523 10 12L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Hidden file input for import -->
<input
  type="file"
  accept=".json"
  bind:this={importFileInput}
  on:change={importBookmarks}
  style="display: none;"
/>

<style>
  /* Container */
  .dialog-container {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  
  /* Backdrop */
  .dialog-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  
  /* Dialog */
  .dialog-content {
    position: relative;
    background: #1c1c1e;
    border-radius: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    width: 100%;
    max-width: 40rem;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  /* Header */
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  
  .dialog-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: #f5f5f7;
    letter-spacing: -0.01em;
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
  
  /* Body */
  .dialog-body {
    flex: 1;
    padding: 1.5rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  /* Sections */
  .section-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.625rem;
    padding: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 1rem;
  }
  
  .section-card:last-child {
    margin-bottom: 0;
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
  
  .section-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e5e5e7;
  }
  
  /* Input Group */
  .input-group {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  
  @media (max-width: 640px) {
    .input-group {
      flex-direction: column;
      align-items: stretch;
    }
  }
  
  /* Inputs */
  .text-input {
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
  
  .text-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #0071e3;
    box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2);
  }
  
  .text-input.readonly {
    color: #a1a1a6;
    cursor: not-allowed;
  }
  
  .text-input::placeholder {
    color: #6e6e73;
  }
  
  /* Buttons */
  .primary-button {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.625rem 1rem;
    background: #0071e3;
    color: white;
    font-weight: 500;
    font-size: 0.875rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
    white-space: nowrap;
  }
  
  .primary-button:hover {
    background: #0077ed;
  }
  
  .primary-button:active {
    background: #006edb;
  }
  
  .primary-button:disabled {
    background: #2c2c2e;
    color: #6e6e73;
    cursor: not-allowed;
  }
  
  .secondary-button {
    display: flex;
    align-items: center;
    gap: 0.375rem;
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
  
  .secondary-button:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.16);
  }
  
  /* Bookmarks List */
  .bookmarks-list {
    max-height: 20rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .empty-state {
    text-align: center;
    color: #6e6e73;
    padding: 2rem;
    font-size: 0.875rem;
  }
  
  .bookmark-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
    transition: all 0.15s ease;
  }
  
  .bookmark-item:last-child {
    margin-bottom: 0;
  }
  
  .bookmark-item:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.08);
  }
  
  .bookmark-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 1;
    min-width: 0;
  }
  
  .bookmark-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: #f5f5f7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .bookmark-details {
    font-size: 0.75rem;
    color: #a1a1a6;
  }
  
  .bookmark-actions {
    display: flex;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  
  /* Action Buttons */
  .action-button {
    padding: 0.375rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a1a1a6;
  }
  
  .action-button:hover {
    color: #f5f5f7;
  }
  
  .action-button.go {
    background: rgba(50, 215, 75, 0.1);
    color: #32d74b;
    border-color: rgba(50, 215, 75, 0.2);
  }
  
  .action-button.go:hover {
    background: rgba(50, 215, 75, 0.15);
    border-color: rgba(50, 215, 75, 0.3);
  }
  
  .action-button.copy {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.08);
  }
  
  .action-button.copy:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    color: #f5f5f7;
  }
  
  .action-button.delete {
    background: rgba(255, 59, 48, 0.1);
    color: #ff3b30;
    border-color: rgba(255, 59, 48, 0.2);
  }
  
  .action-button.delete:hover {
    background: rgba(255, 59, 48, 0.15);
    border-color: rgba(255, 59, 48, 0.3);
  }
  
  /* Scrollbar */
  .bookmarks-list::-webkit-scrollbar,
  .dialog-body::-webkit-scrollbar {
    width: 8px;
  }
  
  .bookmarks-list::-webkit-scrollbar-track,
  .dialog-body::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.02);
  }
  
  .bookmarks-list::-webkit-scrollbar-thumb,
  .dialog-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
  
  .bookmarks-list::-webkit-scrollbar-thumb:hover,
  .dialog-body::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  
  /* Responsive */
  @media (max-width: 640px) {
    .dialog-content {
      max-height: 90vh;
    }
    
    .dialog-body {
      padding: 1rem;
    }
    
    .bookmark-item {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }
    
    .bookmark-actions {
      align-self: flex-end;
    }
  }
</style>