import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://tmsmorhinixrmuddhqkj.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_16ae9I2-S4J49GnEBBWuCQ_q6jhVN0Y';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);