import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for managing fullscreen mode
 * Uses the browser Fullscreen API to make the app look like a native application
 */
const useFullscreen = () => {
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Check if fullscreen is available
    const isFullscreenAvailable = () => {
        return document.fullscreenEnabled ||
            document.webkitFullscreenEnabled ||
            document.mozFullScreenEnabled ||
            document.msFullscreenEnabled;
    };

    // Get current fullscreen element
    const getFullscreenElement = () => {
        return document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement;
    };

    // Enter fullscreen mode
    const enterFullscreen = useCallback(async (element = document.documentElement) => {
        try {
            if (element.requestFullscreen) {
                await element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) {
                await element.webkitRequestFullscreen();
            } else if (element.mozRequestFullScreen) {
                await element.mozRequestFullScreen();
            } else if (element.msRequestFullscreen) {
                await element.msRequestFullscreen();
            }
            return true;
        } catch (error) {
            console.error('Error entering fullscreen:', error);
            return false;
        }
    }, []);

    // Exit fullscreen mode
    const exitFullscreen = useCallback(async () => {
        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                await document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                await document.msExitFullscreen();
            }
            return true;
        } catch (error) {
            console.error('Error exiting fullscreen:', error);
            return false;
        }
    }, []);

    // Toggle fullscreen mode
    const toggleFullscreen = useCallback(async (element) => {
        if (isFullscreen) {
            return exitFullscreen();
        } else {
            return enterFullscreen(element);
        }
    }, [isFullscreen, enterFullscreen, exitFullscreen]);

    // Listen for fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!getFullscreenElement());
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);

        // Check initial state
        setIsFullscreen(!!getFullscreenElement());

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
        };
    }, []);

    return {
        isFullscreen,
        isFullscreenAvailable: isFullscreenAvailable(),
        enterFullscreen,
        exitFullscreen,
        toggleFullscreen
    };
};

export default useFullscreen;
