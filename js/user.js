// js/user.js
const supabase = initSupabase();
let currentUser = null;

window.onload = async () => {
    // 1. GATEKEEPER
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    // 2. ROLE CHECK
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, name')
        .eq('id', session.user.id)
        .single();

    if (profile?.role !== 'user') {
        if (profile.role === 'admin') window.location.href = 'admin.html';
        else window.location.href = 'driver.html';
        return;
    }

    // 3. SAFE: Initialize Page
    currentUser = session.user;
    if (profile.name) document.getElementById('userName').innerText = profile.name.split(' ')[0];

    loadDashboard();

    supabase.channel('resident-view')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadDashboard)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pickups' }, loadDashboard)
        .subscribe();
};

async function loadDashboard() {
    // A. Fetch User's Bins
    const { data: bins } = await supabase
        .from('bins')
        .select('*')
        .eq('owner_id', currentUser.id)
        .order('id');

    // B. Fetch Active Pickups for these bins (Join with Drivers)
    // Note: We fetch ALL active pickups, then filter in JS to match the user's bins
    const { data: activePickups } = await supabase
        .from('pickups')
        .select('*, driver:profiles(name, vehicle_info)') // Join to get Driver Name
        .neq('status', 'completed');

    const grid = document.getElementById('userGrid');

    if (!bins || bins.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-xl shadow-sm border border-slate-200">
                <i class="fas fa-home text-4xl text-slate-300 mb-4"></i>
                <h3 class="text-lg font-bold text-slate-600">No bins assigned.</h3>
                <p class="text-sm text-slate-400">Please contact administration to link your home.</p>
            </div>`;
        document.getElementById('totalBinsCount').innerText = '0';
        return;
    }

    // Update Stats
    document.getElementById('totalBinsCount').innerText = bins.length;
    grid.innerHTML = '';

    // C. Render Cards
    bins.forEach(bin => {
        // 1. Find if this bin has an active pickup
        const pickup = activePickups.find(p => p.bin_id === bin.id);

        // 2. Determine Style based on Fill Level
        const fill = bin.fill_level;
        let colorTheme = 'emerald'; // Default Green
        if (fill > 50) colorTheme = 'amber';
        if (fill > 80) colorTheme = 'red';

        // 3. Driver Status Logic
        let driverStatusHtml = '';
        let actionButtonHtml = '';

        if (pickup) {
            // CASE: Pickup is active
            if (pickup.driver) {
                // Driver Assigned
                driverStatusHtml = `
                    <div class="mt-4 bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center gap-3">
                        <div class="bg-blue-200 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">
                            <i class="fas fa-truck"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-blue-800 uppercase">Driver En Route</p>
                            <p class="text-sm font-bold text-slate-700">${pickup.driver.name}</p>
                            <p class="text-[10px] text-slate-500">${pickup.driver.vehicle_info || 'Transport Unit'}</p>
                        </div>
                    </div>`;
                actionButtonHtml = `
                    <button disabled class="w-full mt-4 bg-slate-100 text-slate-400 py-2 rounded-lg font-bold text-xs cursor-not-allowed">
                        Pickup Scheduled
                    </button>`;
            } else {
                // Pending (Waiting for Admin Dispatch)
                driverStatusHtml = `
                    <div class="mt-4 bg-yellow-50 border border-yellow-100 p-3 rounded-lg flex items-center gap-3">
                        <div class="bg-yellow-200 text-yellow-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">
                            <i class="fas fa-clock"></i>
                        </div>
                        <div>
                            <p class="text-xs font-bold text-yellow-800 uppercase">Request Pending</p>
                            <p class="text-xs text-slate-500">Waiting for dispatch...</p>
                        </div>
                    </div>`;
                actionButtonHtml = `
                    <button disabled class="w-full mt-4 bg-slate-100 text-slate-400 py-2 rounded-lg font-bold text-xs cursor-not-allowed">
                        Request Sent
                    </button>`;
            }
        } else {
            // CASE: No pickup scheduled
            driverStatusHtml = `
                <div class="mt-4 p-3 rounded-lg border border-dashed border-slate-300 text-center">
                    <p class="text-xs text-slate-400">No active schedule</p>
                </div>`;

            // Enable Request button only if bin is getting full (>50%) or force enable for demo
            actionButtonHtml = `
                <button onclick="requestPickup(${bin.id})" class="w-full mt-4 bg-${colorTheme}-500 hover:bg-emerald-700 text-white py-2 rounded-lg font-bold text-sm shadow-lg shadow-emerald-500/20 transition transform active:scale-95">
                    Request Pickup
                </button>`;
        }

        // 4. Build Card HTML
        grid.innerHTML += `
            <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 relative overflow-hidden group hover:shadow-md transition">
                <div class="absolute top-0 left-0 w-full h-1 bg-${colorTheme}-500"></div>

                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h3 class="font-bold text-xl text-slate-800">${bin.location_name}</h3>
                        <p class="text-xs text-slate-400"><i class="fas fa-map-marker-alt mr-1"></i> ${bin.city || 'Home'}</p>
                    </div>
                    <div class="relative w-16 h-16">
                        <svg class="w-full h-full transform -rotate-90">
                            <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="6" fill="transparent" class="text-slate-100" />
                            <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="6" fill="transparent" class="text-${colorTheme}-500" stroke-dasharray="${(fill / 100) * 175} 175" />
                        </svg>
                        <span class="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700">${fill}%</span>
                    </div>
                </div>

                <div class="flex gap-4 mb-2">
                    <div class="flex-1 bg-slate-50 rounded-lg p-2 text-center">
                        <p class="text-[10px] text-slate-400 uppercase font-bold">Weight</p>
                        <p class="font-bold text-slate-700">${bin.weight} kg</p>
                    </div>
                    <div class="flex-1 bg-slate-50 rounded-lg p-2 text-center">
                        <p class="text-[10px] text-slate-400 uppercase font-bold">Status</p>
                        <p class="font-bold text-${colorTheme}-600 capitalize">${colorTheme === 'emerald' ? 'Optimal' : (colorTheme === 'amber' ? 'Moderate' : 'Critical')}</p>
                    </div>
                </div>

                ${driverStatusHtml}
                ${actionButtonHtml}

            </div>
        `;
    });
}

// --- ACTIONS ---

async function requestPickup(binId) {
    if (!confirm("Request a pickup for this bin?")) return;

    // Insert a pending pickup. Driver is NULL until Admin assigns one.
    const { error } = await supabase.from('pickups').insert({
        bin_id: binId,
        driver_id: null, // Admin must assign
        status: 'pending'
    });

    if (error) alert("Error: " + error.message);
    else {
        alert("Request sent to Dispatch!");
        loadDashboard();
    }
}

window.requestPickup = requestPickup;
window.logout = async () => { await supabase.auth.signOut(); window.location.href = 'index.html'; };