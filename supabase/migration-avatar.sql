-- Add avatar_url column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

-- Create public storage bucket for avatars
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to avatars bucket
CREATE POLICY "Public read access for avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Allow service role to manage avatars (handled by service key, but explicit for clarity)
CREATE POLICY "Service role can manage avatars" ON storage.objects
  FOR ALL USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');
