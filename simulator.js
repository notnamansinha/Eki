const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json"); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "bustrack-be165", 
});

const db = admin.firestore();

// Route 01 Path (Roughly)
const path = [
  { lat: 23.0225, lng: 72.5714 },
  { lat: 23.0215, lng: 72.5740 },
  { lat: 23.0200, lng: 72.5757 },
  { lat: 23.0240, lng: 72.5710 },
  { lat: 23.0273, lng: 72.5683 },
  { lat: 23.0300, lng: 72.5640 },
  { lat: 23.0317, lng: 72.5621 },
  { lat: 23.0340, lng: 72.5550 },
  { lat: 23.0371, lng: 72.5499 },
];

let index = 0;

async function moveBus() {
    const pos = path[index];
    console.log(`📡 Simulating Bus GJ01-BT-0001 at ${pos.lat}, ${pos.lng}`);
    
    await db.collection('live_locations').doc('bus_01').set({
        bus_id: 'bus_01',
        trip_id: 'trip_01',
        route_id: 'route_01',
        driver_id: 'user_driver_01',
        lat: pos.lat,
        lng: pos.lng,
        speed_kmh: 30 + Math.random() * 10,
        heading: 45,
        accuracy_m: 5,
        recorded_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        next_stop_id: 'stop_04',
        eta_next_stop_min: Math.max(1, 10 - index)
    });

    index = (index + 1) % path.length;
    setTimeout(moveBus, 3000);
}

console.log("🚀 Starting Live Bus Simulator...");
moveBus();
