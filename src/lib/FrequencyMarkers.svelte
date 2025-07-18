<script>
  import { createEventDispatcher, onMount } from 'svelte'
  import bounds from 'binary-search-bounds'

  import { frequencyToWaterfallOffset, getFrequencyView } from '../lib/backend'

  const dispatch = createEventDispatcher()
  let markerDiv;
  var frequencyList = []
  export function insertAll (frequencies) {
    for (const frequency of frequencies) {
      frequencyList.push([
        frequency.f || frequency.frequency,
        frequency.d || frequency.description,
        frequency.m || frequency.modulation
      ])

    }

    frequencyList = [...frequencyList];
  }
  function frequencyListComparator (a, b) {
    return a[0] - b[0]
  }
  export function finalizeList () {
    frequencyList.sort(frequencyListComparator)
    if (frequencyList.length === 0) {
      markerDiv.style.display = 'none'
    }
  }

  function getFrequencyBoundsInRange (lo, hi) {
    return [bounds.ge(frequencyList, [lo], frequencyListComparator), bounds.ge(frequencyList, [hi], frequencyListComparator)]
  }

  let markerIdCounter = 0;

  function getFrequencyInRange(from, to) {
    return frequencyList.slice(from, to).map(x => ({
      id: markerIdCounter++,
      frequency: x[0],
      description: x[1],
      modulation: x[2],
      left: 0
    }))
  }
  
  let frequencyMarkers = []
  let frequencyBoundsLo = -1
  let frequencyBoundsHi = -1
  export function updateFrequencyMarkerPositions() {
    const [frequencyFrom, frequencyTo] = getFrequencyView();
    const [from, to] = getFrequencyBoundsInRange(frequencyFrom, frequencyTo);
    
    if (frequencyTo - frequencyFrom <= 3500000) {
      if (from !== frequencyBoundsLo || to !== frequencyBoundsHi) {
        frequencyBoundsLo = from;
        frequencyBoundsHi = to;
        frequencyMarkers = getFrequencyInRange(frequencyBoundsLo, frequencyBoundsHi);
      }
    } else {
      frequencyMarkers = [];
      frequencyBoundsHi = -1;
      frequencyBoundsLo = -1;
    }

    // Update the left position, preserving the id
    frequencyMarkers = frequencyMarkers.map(marker => ({
      ...marker,
      left: frequencyToWaterfallOffset(marker.frequency)
    }));

    // Force Svelte to update the component
    frequencyMarkers = [...frequencyMarkers];
  }


  onMount(() => {
    //finalizeList()
  })
</script>
<div on:click|self on:wheel|self class="w-full h-4 bg-black relative" bind:this={markerDiv} role="button">
  {#each frequencyMarkers as frequencyMarker (frequencyMarker.id)}
  <div class="h-4 absolute p-0 group" style="left: {frequencyMarker.left * 100}%"
      on:click={() => dispatch('markerclick', frequencyMarker)}>
      <div class="top-0 w-px h-8 z-0 peer bg-yellow-500 absolute
                  shadow-[0_0_3px_rgba(250,204,21,0.6)] group-hover:shadow-[0_0_6px_rgba(250,204,21,0.8)]
                  transition-shadow duration-300">
      </div>
      <div class="outline-1 outline-black outline-offset-0 outline p-px
          bg-gray-900/90 backdrop-blur-sm absolute bottom-0 z-10 group-hover:z-20 hover:z-20 peer-hover:z-20
          text-left whitespace-pre whitespace-nowrap text-yellow-300 text-xs align-middle
          border border-yellow-600/50 transform origin-bottom-left overflow-hidden
          h-auto max-h-full hover:max-h-screen peer-hover:max-h-screen
          transition-all ease-linear duration-1000
          shadow-lg hover:shadow-xl hover:shadow-yellow-500/20">
      {frequencyMarker.description}</div>
  </div>
  {/each}
</div>