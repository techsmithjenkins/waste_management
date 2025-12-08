// js/app.js

window.onload = async () => {
    // Check if user is already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        redirectUser(session.user.id);
    }
};

async function handleAuth() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const feedback = document.getElementById('feedback');
    const btn = document.getElementById('submitBtn');
    
    // Get mode from index.html script
    const isSignUp = window.getAuthMode ? window.getAuthMode() : false;

    // Basic Validation
    if (!email || !password) {
        feedback.innerText = "Credentials required.";
        feedback.className = "text-center text-sm mt-4 font-bold text-red-500";
        return;
    }

    // Set Loading State
    const originalText = btn.innerText;
    btn.innerText = "Processing...";
    btn.disabled = true;
    feedback.innerText = "";

    try {
        if (isSignUp) {
            // --- SIGN UP LOGIC ---
            const fullName = document.getElementById('fullName').value;
            if (!fullName) throw new Error("Full Legal Name is required for registration.");

            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password
            });

            if (error) throw error;

            if (data.user) {
                // SECURITY: Enforce 'user' role for public signups
                const { error: profileError } = await supabase.from('profiles').insert({
                    id: data.user.id,
                    email: email,
                    name: fullName,
                    role: 'user', // Hardcoded security
                    status: 'active'
                });

                if (profileError) {
                    // Rollback if profile creation fails (optional but cleaner)
                    console.error("Profile creation failed:", profileError);
                }

                alert("Registration Successful! Welcome to WMS.");
                window.location.href = 'user.html';
            }

        } else {
            // --- LOGIN LOGIC ---
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            await redirectUser(data.user.id);
        }

    } catch (err) {
        feedback.innerText = err.message;
        feedback.className = "text-center text-sm mt-4 font-bold text-red-500";
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function redirectUser(userId) {
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

    if (profile?.role === 'admin') window.location.href = 'admin.html';
    else if (profile?.role === 'driver') window.location.href = 'driver.html';
    else window.location.href = 'user.html';
}