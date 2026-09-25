import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_PAYMENT_RECEIVING_NUMBER } from '@/lib/platformConfig';

interface PlatformSettings {
  payment_receiving_number: string;
}

/**
 * Fetches the platform payment receiving number from the database.
 * Falls back to the default constant if the database is unreachable.
 * Subscribes to realtime changes on `platform_settings` so the number
 * updates automatically when an admin changes it.
 */
export function usePaymentReceivingNumber() {
  const [receivingNumber, setReceivingNumber] = useState(DEFAULT_PAYMENT_RECEIVING_NUMBER);
  const [loading, setLoading] = useState(true);

  const fetchNumber = useCallback(async () => {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('payment_receiving_number')
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setReceivingNumber((data as PlatformSettings).payment_receiving_number);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNumber();

    const channel = supabase
      .channel('rt:platform_settings:all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'platform_settings' },
        () => fetchNumber(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNumber]);

  return { receivingNumber, loading, refresh: fetchNumber };
}
