import { writable } from 'svelte/store';

// Default frequency step settings
const defaultSteps = {
    mouseWheelStep: 0.5,
    keyboardStep: 0.5,
    keyboardJumpStep: 10
};

// Load settings from localStorage or use defaults
function loadSettings() {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('frequencySteps');
        if (saved) {
            try {
                return { ...defaultSteps, ...JSON.parse(saved) };
            } catch (e) {
                console.warn('Failed to load frequency step settings from localStorage:', e);
            }
        }
    }
    return defaultSteps;
}

// Create the store
export const frequencySteps = writable(loadSettings());

// Save settings to localStorage when they change
frequencySteps.subscribe(value => {
    if (typeof window !== 'undefined') {
        localStorage.setItem('frequencySteps', JSON.stringify(value));
    }
});

// Helper function to update a specific step setting
export function updateStep(key, value) {
    frequencySteps.update(current => ({
        ...current,
        [key]: value
    }));
}