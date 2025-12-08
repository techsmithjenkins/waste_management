// --- AUTO-INJECT FAVICON ---
(function() {
    const link = document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = 'assets/logo.png'; 
    document.head.appendChild(link);
})();

// js/config.js
// 1. Initialize Supabase
const CONFIG = {
    SUPABASE_URL: 'https://bcnhytumcigxyxwdzasb.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjbmh5dHVtY2lneHl4d2R6YXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwMzU4OTcsImV4cCI6MjA4MDYxMTg5N30.pfjJBzwjD7zk9EnLKNh4OYRMuQq7bn4jc1YxsIsW_NI'
};

// Helper to init Supabase in any file
function initSupabase() {
    return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
}