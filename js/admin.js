// js/admin.js
const supabase = initSupabase();

window.onload = async () => {
    await checkAdminSession();
    await loadDashboard();
    
    // Subscribe to changes for live updates
    supabase.channel('admin-updates')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadDashboard)
        .subscribe();
};

// --- SECURITY ---
async function checkAdminSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) window.location.href = 'index.html';

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    }
}

// --- CORE DASHBOARD ---
async function loadDashboard() {
    const cityFilter = document.getElementById('cityFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;

    // 1. Fetch Bins
    let query = supabase.from('bins').select('*, profiles:owner_id(name)');
    if (cityFilter !== 'all') query = query.eq('city', cityFilter);
    const { data: bins, error: binError } = await query;
    if (binError) return console.error("Fetch Error:", binError);

    // 2. Fetch Drivers
    const { data: drivers } = await supabase.from('profiles').select('id, name').eq('role', 'driver');

    // 3. Fetch Active Pickups (for alerts)
    const { data: pickups } = await supabase
        .from('pickups')
        .select('*, bin:bins(location_name), driver:profiles(name)')
        .or('status.eq.pending,issue_report.neq.null');

    // 4. Update UI Components
    updateMetrics(bins, drivers);
    updateNotificationBadge(pickups || []); // New Helper
    renderGrid(bins, drivers, statusFilter, pickups || []); // Pass pickups to grid
}

function updateMetrics(bins, drivers) {
    document.getElementById('stat-total').innerText = bins.length;
    document.getElementById('stat-critical').innerText = bins.filter(b => b.fill_level >= 80).length;
    document.getElementById('stat-drivers').innerText = drivers.length;
}

function renderGrid(bins, drivers, statusFilter, pickups = []) {
    const grid = document.getElementById('binsGrid');
    grid.innerHTML = '';

    const filteredBins = statusFilter === 'critical' 
        ? bins.filter(b => b.fill_level >= 80) 
        : bins;

    if (filteredBins.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center text-slate-400 py-10">No bins found matching criteria.</div>`;
        return;
    }

    filteredBins.forEach(bin => {
        // Check for active alerts on this bin
        const pendingReq = pickups.find(p => p.bin_id === bin.id && p.status === 'pending' && !p.driver_id);
        const hasIssue = pickups.find(p => p.bin_id === bin.id && p.issue_report);

        // --- STYLING LOGIC UPGRADE ---
        const isCritical = bin.fill_level >= 80;
        
        // Default: White background. Only turns Red if critical.
        let bgClass = isCritical ? 'bg-red-50' : 'bg-white';
        // Default: Gray border. Turns Red if critical.
        let borderClass = isCritical ? 'border-red-200' : 'border-slate-200';
        let statusBadge = '';
        
        // Alerts affect BORDER and BADGE only (Background remains white unless critical)
        if (hasIssue) {
            statusBadge = `<div class="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg z-10 shadow-sm"><i class="fas fa-exclamation-triangle mr-1"></i> ISSUE</div>`;
            borderClass = 'border-red-500 ring-2 ring-red-100'; // Strong Red Border
        } else if (pendingReq) {
            statusBadge = `<div class="absolute top-0 right-0 bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg z-10 shadow-sm"><i class="fas fa-hand-paper mr-1"></i> REQUEST</div>`;
            borderClass = 'border-blue-500 ring-2 ring-blue-100'; // Strong Blue Border
        }

        const barColor = isCritical ? 'bg-red-500' : (bin.fill_level > 50 ? 'bg-amber-400' : 'bg-emerald-500');
        const driverOptions = drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');

        const card = `
        <div class="rounded-2xl shadow-sm border ${borderClass} ${bgClass} p-6 hover:shadow-lg transition duration-300 relative group overflow-hidden">
            ${statusBadge}
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h3 class="font-bold text-slate-700 text-lg">${bin.location_name}</h3>
                    <p class="text-xs text-slate-500 flex items-center gap-1 mt-1"><i class="fas fa-map-marker-alt text-slate-400"></i> ${bin.city}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="deleteBin('${bin.id}')" class="text-slate-300 hover:text-red-500 transition" title="Delete Bin">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button onclick="showMap(${bin.lat}, ${bin.lng})" class="text-slate-400 hover:text-blue-500 transition" title="View Map">
                        <i class="fas fa-map-marked-alt text-xl"></i>
                    </button>
                </div>
            </div>
            <div class="mb-5">
                <div class="flex justify-between text-xs font-bold mb-2">
                    <span class="text-slate-500">Capacity</span>
                    <span class="${isCritical ? 'text-red-600' : 'text-slate-700'}">${bin.fill_level}%</span>
                </div>
                <div class="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                    <div class="${barColor} h-full transition-all duration-700 ease-out" style="width: ${bin.fill_level}%"></div>
                </div>
            </div>
            <div class="pt-4 border-t border-slate-200/60">
                <div class="flex gap-2 mt-1">
                    <select id="driver-${bin.id}" class="bg-white border border-slate-200 text-slate-700 text-xs rounded-lg p-2 w-full outline-none"><option value="">Select Driver...</option>${driverOptions}</select>
                    <button onclick="dispatchDriver('${bin.id}')" class="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition"><i class="fas fa-paper-plane"></i></button>
                </div>
            </div>
        </div>`;
        grid.innerHTML += card;
    });
}

// --- ACTIONS ---

async function createUser() {
    const name = document.getElementById('newUserName').value;
    const email = document.getElementById('newUserEmail').value;
    const role = document.getElementById('newUserRole').value;

    if (!name || !email) return alert("Please fill all fields");

    // Fix: We create a profile manually. 
    const tempId = crypto.randomUUID(); 

    const { error } = await supabase.from('profiles').insert({
        id: tempId, 
        email: email,
        name: name,
        role: role
    });

    if (error) {
        alert("Error: " + error.message);
    } else {
        alert("Success: Profile created.\nPlease ask the staff member to 'Sign Up' with this email.");
        toggleModal('userModal');
    }
}

async function createBin() {
    const location_name = document.getElementById('newBinName').value;
    const city = document.getElementById('newBinCity').value;
    const lat = parseFloat(document.getElementById('newBinLat').value) || 0;
    const lng = parseFloat(document.getElementById('newBinLng').value) || 0;

    const { error } = await supabase.from('bins').insert({ location_name, city, lat, lng });
    if (error) alert(error.message);
    else {
        alert("Asset Deployed.");
        toggleModal('binModal');
        loadDashboard();
    }
}

// NEW: Delete Bin Function
async function deleteBin(binId) {
    if(!confirm("Are you sure you want to permanently delete this bin?")) return;
    const { error } = await supabase.from('bins').delete().eq('id', binId);
    if(error) alert(error.message);
    else loadDashboard();
}

async function dispatchDriver(binId) {
    const driverId = document.getElementById(`driver-${binId}`).value;
    if (!driverId) return alert("Please select a driver first.");

    const { error } = await supabase.from('pickups').insert({
        bin_id: binId,
        driver_id: driverId,
        status: 'pending'
    });

    if (error) alert("Error: " + error.message);
    else alert("Driver Dispatched successfully!");
}

async function simulateSensors() {
    const btn = document.getElementById('simBtn');
    btn.classList.add('animate-spin'); 
    
    const { data: bins } = await supabase.from('bins').select('id');
    
    for (const bin of bins) {
        const newFill = Math.floor(Math.random() * 100);
        const newWeight = (newFill * 0.45).toFixed(2);
        await supabase.from('bins').update({ fill_level: newFill, weight: newWeight }).eq('id', bin.id);
    }

    setTimeout(() => {
        btn.classList.remove('animate-spin');
        loadDashboard();
    }, 1000);
}

// --- UTILITIES ---

function showMap(lat, lng) {
    const modal = document.getElementById('mapModal');
    const container = document.getElementById('mapFrameContainer');
    container.innerHTML = `<iframe width="100%" height="100%" frameborder="0" scrolling="no" marginheight="0" marginwidth="0" src="https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.01}%2C${lat-0.01}%2C${lng+0.01}%2C${lat+0.01}&amp;layer=mapnik&amp;marker=${lat}%2C${lng}" style="border: 1px solid black"></iframe>`;
    modal.classList.remove('hidden');
}

function closeMap() {
    document.getElementById('mapModal').classList.add('hidden');
    document.getElementById('mapFrameContainer').innerHTML = '';
}

window.toggleModal = (id) => document.getElementById(id).classList.toggle('hidden');
window.showMap = showMap;
window.closeMap = closeMap;
window.logout = async () => { await supabase.auth.signOut(); window.location.href = 'index.html'; };

// --- 1. STAFF MANAGER (Drivers) ---

async function openStaffManager() {
    toggleModal('staffModal');
    const tbody = document.getElementById('driverListBody');
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">Loading Fleet Data...</td></tr>';

    const { data: drivers } = await supabase.from('profiles').select('*').eq('role', 'driver').order('name');

    tbody.innerHTML = '';
    if (!drivers || drivers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">No drivers found.</td></tr>';
        return;
    }

    drivers.forEach(driver => {
        const simLat = (5.60 + Math.random() * 0.01).toFixed(4);
        const simLng = (-0.18 + Math.random() * 0.01).toFixed(4);

        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="p-4 font-bold text-slate-700">${driver.name || 'Unknown'}</td>
                <td class="p-4 text-sm text-slate-500">${driver.vehicle_info || 'Unassigned'}</td>
                <td class="p-4 flex items-center gap-2">
                    <span class="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-bold">● On Duty</span>
                    <button onclick="deleteStaff('${driver.id}')" class="text-slate-400 hover:text-red-500" title="Remove Driver"><i class="fas fa-trash"></i></button>
                </td>
                <td class="p-4 font-mono text-xs text-blue-600 bg-blue-50/50">
                    <i class="fas fa-satellite-dish mr-1"></i> ${simLat}, ${simLng}
                </td>
            </tr>
        `;
    });
}

// NEW: Delete Staff Function
async function deleteStaff(driverId) {
    if(!confirm("Are you sure? This will remove the driver from the system.")) return;
    const { error } = await supabase.from('profiles').delete().eq('id', driverId);
    if(error) alert(error.message);
    else openStaffManager();
}

// --- 2. ASSIGNMENT MANAGER (Residents + Multiple Bins) ---

async function openAssignmentManager() {
    toggleModal('assignmentModal');
    const tbody = document.getElementById('residentListBody');
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">Loading Resident Data...</td></tr>';

    const { data: profiles } = await supabase.from('profiles').select('*').eq('role', 'user').order('name');
    const { data: bins } = await supabase.from('bins').select('*');
    const unassignedBins = bins.filter(b => !b.owner_id);

    tbody.innerHTML = '';
    if (!profiles || profiles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">No residents registered.</td></tr>';
        return;
    }

    profiles.forEach(user => {
        const userBins = bins.filter(b => b.owner_id === user.id);
        let binListHtml = '';
        if (userBins.length > 0) {
            binListHtml = `<div class="flex flex-wrap gap-2">`;
            userBins.forEach(bin => {
                binListHtml += `
                    <div class="flex items-center gap-1 bg-blue-50 border border-blue-100 text-blue-700 px-2 py-1 rounded text-xs">
                        <i class="fas fa-trash-alt"></i> ${bin.location_name}
                        <button onclick="unassignBin('${bin.id}')" class="ml-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full w-4 h-4 flex items-center justify-center transition" title="Unlink">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>`;
            });
            binListHtml += `</div>`;
        } else {
            binListHtml = `<span class="text-slate-400 italic text-sm">No assets assigned</span>`;
        }

        let actionHtml = '';
        if (unassignedBins.length > 0) {
            const options = unassignedBins.map(b => `<option value="${b.id}">${b.location_name}</option>`).join('');
            actionHtml = `
                <div class="flex justify-end gap-2">
                    <select id="assign-select-${user.id}" class="bg-white border border-slate-300 text-xs rounded p-1.5 w-40 focus:border-blue-500 outline-none">
                        <option value="">Select Bin...</option>
                        ${options}
                    </select>
                    <button onclick="assignBinToUser('${user.id}')" class="bg-green-600 text-white px-3 py-1.5 rounded text-xs hover:bg-green-700 shadow-sm font-bold">
                        <i class="fas fa-plus"></i> Add
                    </button>
                </div>
            `;
        } else {
            actionHtml = `<div class="text-right text-xs text-slate-400">No available bins</div>`;
        }

        tbody.innerHTML += `
            <tr class="hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <td class="p-4 font-bold text-slate-700">${user.name || 'Unknown'}</td>
                <td class="p-4 text-sm text-slate-500">${user.email}</td>
                <td class="p-4">${binListHtml}</td>
                <td class="p-4">${actionHtml}</td>
            </tr>
        `;
    });
}

async function assignBinToUser(userId) {
    const select = document.getElementById(`assign-select-${userId}`);
    const binId = select.value;
    if (!binId) return alert("Please select a bin first.");
    const { error } = await supabase.from('bins').update({ owner_id: userId }).eq('id', binId);
    if (error) alert(error.message);
    else {
        openAssignmentManager(); // Refresh list to show new bin
        loadDashboard(); // Refresh main dashboard background
    }
}

async function unassignBin(binId) {
    if (!confirm("Are you sure you want to unlink this bin from the resident?")) return;
    const { error } = await supabase.from('bins').update({ owner_id: null }).eq('id', binId);
    if (error) alert(error.message);
    else {
        openAssignmentManager(); // Refresh list
        loadDashboard(); // Refresh main dashboard
    }
}

// --- NEW OPERATIONS LOGIC ---

function updateNotificationBadge(pickups) {
    const requests = pickups.filter(p => p.status === 'pending' && !p.driver_id).length;
    const issues = pickups.filter(p => p.issue_report).length;
    const total = requests + issues;
    const badge = document.getElementById('notificationCount');
    const bell = document.getElementById('bellIcon');
    
    if (total > 0) {
        badge.innerText = total;
        badge.classList.remove('hidden');
        bell.classList.add('text-red-500', 'animate-pulse');
    } else {
        badge.classList.add('hidden');
        bell.classList.remove('text-red-500', 'animate-pulse');
    }
}

async function openOperationsCenter() {
    toggleModal('opsModal');
    
    const reqList = document.getElementById('requestsList');
    const repList = document.getElementById('reportsList');
    
    reqList.innerHTML = '<div class="text-center py-4 text-slate-400"><i class="fas fa-circle-notch animate-spin"></i> Loading Requests...</div>';
    repList.innerHTML = '<div class="text-center py-4 text-slate-400"><i class="fas fa-circle-notch animate-spin"></i> Loading Reports...</div>';

    try {
        const { data: pickups, error: pickupError } = await supabase
            .from('pickups')
            .select('*, bin:bins(*), driver:profiles(name)')
            .or('status.eq.pending,issue_report.neq.null')
            .order('created_at', { ascending: false });

        if (pickupError) throw pickupError;

        const { data: drivers, error: driverError } = await supabase
            .from('profiles')
            .select('id, name')
            .eq('role', 'driver');

        if (driverError) throw driverError;

        const safePickups = pickups || [];
        const requests = safePickups.filter(p => p.status === 'pending' && !p.driver_id);
        const issues = safePickups.filter(p => p.issue_report);

        reqList.innerHTML = '';
        if (requests.length === 0) {
            reqList.innerHTML = '<p class="text-slate-400 text-xs text-center italic mt-4">No pending requests.</p>';
        } else {
            requests.forEach(req => {
                const driverOpts = drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
                reqList.innerHTML += `
                    <div class="bg-white p-4 rounded-lg border border-slate-200 shadow-sm mb-3">
                        <div class="flex justify-between items-start mb-2">
                            <h5 class="font-bold text-slate-700">${req.bin ? req.bin.location_name : 'Unknown Location'}</h5>
                            <span class="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded uppercase font-bold">Request</span>
                        </div>
                        <p class="text-xs text-slate-500 mb-3">
                            <i class="fas fa-clock mr-1"></i> ${new Date(req.created_at || Date.now()).toLocaleTimeString()}
                        </p>
                        <div class="flex gap-2">
                            <select id="ops-driver-${req.id}" class="bg-slate-50 border border-slate-200 text-xs rounded p-2 w-full outline-none">
                                <option value="">Assign Driver...</option>
                                ${driverOpts}
                            </select>
                            <button onclick="dispatchFromOps('${req.id}')" class="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-green-700 shadow-sm">Dispatch</button>
                        </div>
                    </div>`;
            });
        }

        repList.innerHTML = '';
        if (issues.length === 0) {
            repList.innerHTML = '<p class="text-slate-400 text-xs text-center italic mt-4">No active issues.</p>';
        } else {
            issues.forEach(issue => {
                repList.innerHTML += `
                    <div class="bg-white p-4 rounded-lg border-l-4 border-red-500 shadow-sm relative mb-3">
                        <button onclick="clearIssue('${issue.id}')" class="absolute top-2 right-2 text-slate-300 hover:text-green-500" title="Resolve"><i class="fas fa-check-circle"></i></button>
                        <h5 class="font-bold text-slate-700 mb-1">${issue.bin ? issue.bin.location_name : 'Unknown Bin'}</h5>
                        <p class="text-xs text-red-600 font-bold">Driver: ${issue.driver ? issue.driver.name : 'Unassigned'}</p>
                        <div class="bg-red-50 p-2 mt-2 rounded text-xs text-slate-700 italic border border-red-100">
                            "${issue.issue_report}"
                        </div>
                    </div>`;
            });
        }

    } catch (err) {
        console.error("Ops Center Error:", err);
        reqList.innerHTML = `<div class="p-4 bg-red-100 text-red-700 text-xs rounded">Error: ${err.message}</div>`;
        repList.innerHTML = `<div class="p-4 bg-red-100 text-red-700 text-xs rounded">Check console for details.</div>`;
    }
}

async function dispatchFromOps(pickupId) {
    const driverId = document.getElementById(`ops-driver-${pickupId}`).value;
    if(!driverId) return alert("Select a driver");
    const { error } = await supabase.from('pickups').update({ driver_id: driverId, status: 'pending' }).eq('id', pickupId);
    if(!error) { alert("Dispatched!"); openOperationsCenter(); loadDashboard(); }
}

async function clearIssue(pickupId) {
    if(!confirm("Resolve issue?")) return;
    const { error } = await supabase.from('pickups').update({ issue_report: null }).eq('id', pickupId);
    if(!error) { openOperationsCenter(); loadDashboard(); }
}

// Global Exports
window.openOperationsCenter = openOperationsCenter;
window.dispatchFromOps = dispatchFromOps;
window.clearIssue = clearIssue;
window.deleteBin = deleteBin;
window.deleteStaff = deleteStaff;
window.openStaffManager = openStaffManager;
window.openAssignmentManager = openAssignmentManager;
window.assignBinToUser = assignBinToUser;
window.unassignBin = unassignBin;