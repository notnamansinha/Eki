"use client";

import { useState, useCallback } from 'react';

export function usePlacesAutocomplete() {
  const [predictions, setPredictions] = useState<any[]>([]);

  const fetchPredictions = useCallback((input: string) => {
    // Mocked out since Google Maps API is removed
    setPredictions([]);
  }, []);

  const onPlaceSelected = useCallback((placeId: string) => {
    // Do nothing
  }, []);

  return { predictions, fetchPredictions, onPlaceSelected };
}
