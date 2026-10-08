import { auth, firebaseConfig } from "./firebase-config.js";
import { 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const googleProvider = new GoogleAuthProvider();
const RTDB_BASE = firebaseConfig.databaseURL || "https://zoneprotrader-90959-default-rtdb.firebaseio.com";
const LOCAL_REGISTRY_KEY = "zp_registered_users_registry";

// Helper to encode email for safe database key
function encodeEmailKey(email) {
    return btoa(email.toLowerCase().trim()).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Utility to sync user data to session and database
async function syncUserToDatabase(user, customName = null) {
    const uid = user.uid || ("usr_" + encodeEmailKey(user.email || ""));
    const email = (user.email || "").toLowerCase().trim();
    const name = customName || user.displayName || (user.name) || email.split("@")[0] || "Trader";
    const photo = user.photoURL || "";

    localStorage.setItem("zp_uid", uid);
    localStorage.setItem("zp_user", email);
    localStorage.setItem("zp_name", name);
    if (photo) localStorage.setItem("zp_photo", photo);

    try {
        if (typeof user.getIdToken === "function") {
            const token = await user.getIdToken();
            localStorage.setItem("firebase_id_token", token);
        }
    } catch (e) {}

    try {
        await fetch("/api/user/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-UID": uid },
            body: JSON.stringify({ uid, email, name, photo, lastLoginAt: Date.now() })
        });
    } catch (err) {}
}

// Helper to fetch registered user from Realtime Database
async function getRegisteredUserFromDb(email) {
    const key = encodeEmailKey(email);
    // 1. Check local registry cache
    try {
        const localRegistry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || "{}");
        if (localRegistry[key]) return localRegistry[key];
    } catch (e) {}

    // 2. Check Firebase RTDB
    try {
        const res = await fetch(`${RTDB_BASE}/registered_users/${key}.json`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.email) {
                // Update local cache
                try {
                    const localRegistry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || "{}");
                    localRegistry[key] = data;
                    localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(localRegistry));
                } catch (e) {}
                return data;
            }
        }
    } catch (err) {
        console.warn("RTDB lookup warning:", err);
    }
    return null;
}

// Helper to save newly registered user to Realtime Database & Local cache
async function saveRegisteredUserToDb(userObj) {
    const key = encodeEmailKey(userObj.email);
    
    // Save to local cache
    try {
        const localRegistry = JSON.parse(localStorage.getItem(LOCAL_REGISTRY_KEY) || "{}");
        localRegistry[key] = userObj;
        localStorage.setItem(LOCAL_REGISTRY_KEY, JSON.stringify(localRegistry));
    } catch (e) {}

    // Save to Firebase RTDB
    try {
        await fetch(`${RTDB_BASE}/registered_users/${key}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userObj)
        });
    } catch (err) {
        console.warn("RTDB user save error:", err);
    }
}

// Display error in UI
function showError(message) {
    const errorEl = document.getElementById("auth-error");
    if (errorEl) {
        errorEl.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 shrink-0 text-red-500"></i><span>${message}</span>`;
        errorEl.classList.remove("hidden");
        if (window.lucide) window.lucide.createIcons();
    } else {
        alert(message);
    }
}

function hideError() {
    const errorEl = document.getElementById("auth-error");
    if (errorEl) errorEl.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
    // 1. Google Sign-In
    const googleBtn = document.getElementById("google-signin");
    if (googleBtn) {
        googleBtn.addEventListener("click", async () => {
            hideError();
            try {
                const result = await signInWithPopup(auth, googleProvider);
                const user = result.user;
                
                // Register Google user in database
                await saveRegisteredUserToDb({
                    uid: user.uid,
                    email: user.email,
                    name: user.displayName || "Google Trader",
                    photo: user.photoURL || "",
                    provider: "google",
                    createdAt: Date.now()
                });

                await syncUserToDatabase(user);
                window.location.href = "dashboard.html";
            } catch (error) {
                console.error("Google Auth Error:", error);
                if (error.code === 'auth/popup-closed-by-user') {
                    showError("Google sign-in popup was closed before completing.");
                } else if (error.code === 'auth/unauthorized-domain') {
                    showError("Google sign-in domain is pending Firebase whitelist. Please sign up using your email and password above.");
                } else {
                    showError(error.message || "Google sign-in failed. Please try again.");
                }
            }
        });
    }

    // 2. Email / Password Form (Strict Signup & Login Validation)
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            hideError();

            const emailInput = document.getElementById("email-input");
            const passInput = document.getElementById("password-input");
            const isSignUp = loginForm.getAttribute("data-mode") === "signup";
            const nameInput = document.getElementById("name-input");

            const email = (emailInput?.value || "").trim().toLowerCase();
            const password = passInput?.value || "";
            const fullName = nameInput?.value?.trim() || "";

            // Validation
            if (!email || !password) {
                showError("Please enter both email address and password.");
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showError("Please enter a valid email address (e.g. name@example.com).");
                return;
            }

            if (password.length < 6) {
                showError("Password must be at least 6 characters long.");
                return;
            }

            const submitBtn = document.getElementById("submit-btn");
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<span class="inline-flex items-center gap-2"><svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${isSignUp ? "Creating account..." : "Verifying credentials..."}</span>`;
            }

            const resetButton = () => {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = isSignUp ? "Sign Up" : "Log In";
                }
            };

            // ==================== SIGN UP FLOW ====================
            if (isSignUp) {
                if (!fullName) {
                    showError("Please enter your Full Name to complete registration.");
                    resetButton();
                    return;
                }

                // Check if user already exists
                const existingUser = await getRegisteredUserFromDb(email);
                if (existingUser) {
                    showError("An account with this email is already registered. Please click 'Log In' instead.");
                    resetButton();
                    return;
                }

                try {
                    let userCredential;
                    let uid;
                    try {
                        userCredential = await createUserWithEmailAndPassword(auth, email, password);
                        uid = userCredential.user.uid;
                    } catch (fbAuthErr) {
                        if (fbAuthErr.code === 'auth/email-already-in-use') {
                            showError("This email is already registered in Firebase. Please log in.");
                            resetButton();
                            return;
                        }
                        // Create a persistent user ID for custom authentication
                        uid = "usr_" + encodeEmailKey(email);
                    }

                    const newUser = {
                        uid,
                        email,
                        name: fullName,
                        password: password, // Stored for verification
                        createdAt: Date.now()
                    };

                    // Save to Database and Local Registry
                    await saveRegisteredUserToDb(newUser);
                    await syncUserToDatabase(newUser, fullName);

                    // Redirect to dashboard
                    window.location.href = "dashboard.html";
                } catch (err) {
                    console.error("Sign up error:", err);
                    showError("Registration failed: " + (err.message || "Please try again."));
                    resetButton();
                }
            } 
            // ==================== LOGIN FLOW ====================
            else {
                // Check if account exists in database / registry first
                const registeredUser = await getRegisteredUserFromDb(email);

                // 1. Try Firebase Auth
                let firebaseLoginSuccess = false;
                try {
                    const userCredential = await signInWithEmailAndPassword(auth, email, password);
                    if (userCredential && userCredential.user) {
                        firebaseLoginSuccess = true;
                        const finalName = registeredUser?.name || userCredential.user.displayName || email.split("@")[0];
                        await syncUserToDatabase(userCredential.user, finalName);
                        window.location.href = "dashboard.html";
                        return;
                    }
                } catch (fbErr) {
                    // If wrong password in Firebase
                    if (fbErr.code === 'auth/wrong-password') {
                        showError("Incorrect password. Please verify and try again.");
                        resetButton();
                        return;
                    }
                }

                // 2. Check Database / Registered Users Verification
                if (!registeredUser) {
                    // DO NOT ALLOW RANDOM EMAILS!
                    showError("No account found with this email. You must click 'Sign Up' first to register.");
                    resetButton();
                    return;
                }

                // Verify password against registered credentials
                if (registeredUser.password && registeredUser.password !== password) {
                    showError("Incorrect password. Please verify and try again.");
                    resetButton();
                    return;
                }

                // Password verified! Log in user
                await syncUserToDatabase(registeredUser, registeredUser.name);
                window.location.href = "dashboard.html";
            }
        });
    }
});
