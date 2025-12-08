// js/driver.js
const supabase = initSupabase();
let currentUser = null;

window.onload = async () => {
    // 1. GATEKEEPER
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    // 2. ROLE CHECK (Strict Mode)
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, name')
        .eq('id', session.user.id)
        .single();

    // If they aren't a driver, redirect them to the correct page
    if (profile?.role !== 'driver') {
        if(profile.role === 'admin') window.location.href = 'admin.html';
        else window.location.href = 'user.html';
        return;
    }

    // 3. SAFE: Initialize Page
    currentUser = session.user;
    if (profile.name) document.getElementById('driverName').innerText = profile.name.split(' ')[0];
    
    loadJobs();
    
    supabase.channel('driver-jobs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pickups' }, loadJobs)
        .subscribe();
};

async function loadJobs() {
    const { data: pickups } = await supabase
        .from('pickups')
        .select('*, bin:bins(*)')
        .eq('driver_id', currentUser.id)
        .neq('status', 'completed')
        .order('scheduled_at', { ascending: false });

    const grid = document.getElementById('driverGrid');
    grid.innerHTML = '';

    if (!pickups || pickups.length === 0) {
        grid.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-slate-400 bg-white rounded-2xl border border-slate-200">
                <i class="fas fa-check-circle text-4xl mb-3 text-green-200"></i>
                <p>All clear. No active assignments.</p>
            </div>`;
        return;
    }

    pickups.forEach(job => {
        const isCritical = job.bin.fill_level >= 80;
        const borderClass = isCritical ? 'border-l-8 border-red-500' : 'border-l-8 border-amber-400';
        const bgClass = isCritical ? 'bg-red-50' : 'bg-white';
        const badge = isCritical 
            ? `<span class="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">Critical Fill</span>` 
            : `<span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">Standard Pickup</span>`;

        grid.innerHTML += `
            <div class="${bgClass} rounded-xl shadow-sm ${borderClass} p-5 relative transition-transform hover:scale-[1.01]">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            ${badge}
                            <span class="text-[10px] text-slate-400 font-mono">ID: ${job.id}</span>
                        </div>
                        <h3 class="font-bold text-xl text-slate-800">${job.bin.location_name}</h3>
                        <p class="text-sm text-slate-500"><i class="fas fa-map-pin mr-1"></i> ${job.bin.city}</p>
                    </div>
                </div>

                <div class="flex gap-4 mb-5 text-sm">
                    <div class="flex flex-col">
                        <span class="text-[10px] text-slate-400 font-bold uppercase">Fill Level</span>
                        <span class="font-bold ${isCritical ? 'text-red-600' : 'text-slate-700'}">${job.bin.fill_level}%</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-[10px] text-slate-400 font-bold uppercase">Weight</span>
                        <span class="font-bold text-slate-700">${job.bin.weight} kg</span>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <button onclick="openNavigation(${job.bin.lat}, ${job.bin.lng})" 
                        class="col-span-2 bg-slate-800 text-white py-3 rounded-lg font-bold hover:bg-slate-700 shadow-lg shadow-slate-500/20 flex justify-center items-center gap-2">
                        <i class="fas fa-location-arrow"></i> Navigate to Bin
                    </button>
                    <button onclick="completeJob(${job.id})" 
                        class="bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-500 shadow-lg shadow-green-500/20 flex justify-center items-center gap-2">
                        <i class="fas fa-check"></i> Complete
                    </button>
                    <button onclick="openReportModal(${job.id})" 
                        class="bg-white text-slate-600 border border-slate-200 py-3 rounded-lg font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition flex justify-center items-center gap-2">
                        <i class="fas fa-triangle-exclamation"></i> Issue
                    </button>
                </div>
            </div>
        `;
    });
}

// Global Exports
window.completeJob = async (jobId) => {
    if(confirm('Confirm waste collected?')) {
        await supabase.from('pickups').update({ status: 'completed' }).eq('id', jobId);
        loadJobs();
    }
};

window.openNavigation = (lat, lng) => {
    if(!lat || !lng) return alert("GPS Coordinates missing.");
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
};

window.openReportModal = (jobId) => {
    document.getElementById('reportPickupId').value = jobId;
    document.getElementById('reportReason').value = '';
    document.getElementById('reportModal').classList.remove('hidden');
};

window.toggleReportModal = () => document.getElementById('reportModal').classList.toggle('hidden');

window.submitReport = async () => {
    const id = document.getElementById('reportPickupId').value;
    const issue = document.getElementById('reportReason').value;
    if(!issue) return alert("Please enter a reason.");

    // Assuming you ran the SQL to add 'issue_report' column
    const { error } = await supabase.from('pickups')
        .update({ issue_report: issue, status: 'completed' }) 
        .eq('id', id);

    if(error) alert("Error: " + error.message);
    else {
        alert("Report Submitted.");
        toggleReportModal();
        loadJobs();
    }
};

window.logout = async () => { await supabase.auth.signOut(); window.location.href = 'index.html'; };