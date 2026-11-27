import { useEffect, useState } from "react";
import { apiFetch, useAuth } from "./auth";
import { SHRUTHI_OPTIONS } from "./shruthiOptions";

const EMPTY_FORM = {
  email: "",
  firstName: "",
  surname: "",
  parentName: "",
  musicTeacherName: "",
  contactNumber: "",
  address: "",
  learningMode: "",
  instrumentName: "",
  defaultShruthi: "normal-G",
  password: "",
  passwordConfirm: "",
};

const VIEW_TITLES = {
  login: "Sign in",
  register: "Create your account",
  profile: "Your details",
  forgot: "Reset your password",
  reset: "Choose a new password",
};

export default function AccountMenu() {
  const { user, loading, authError, login, register, logout, updateProfile } = useAuth();
  const resetParams = new URLSearchParams(window.location.search);
  const resetUid = resetParams.get("uid") || "";
  const resetToken = resetParams.get("token") || "";
  const [dialogOpen, setDialogOpen] = useState(Boolean(resetUid && resetToken));
  const [view, setView] = useState(resetUid && resetToken ? "reset" : "login");
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view === "profile" && user) {
      setForm({
        ...EMPTY_FORM,
        email: user.email || "",
        firstName: user.firstName || "",
        surname: user.surname || "",
        parentName: user.parentName || "",
        musicTeacherName: user.musicTeacherName || "",
        contactNumber: user.contactNumber || "",
        address: user.address || "",
        learningMode: user.learningMode || "",
        instrumentName: user.instrumentName || "",
        defaultShruthi: user.defaultShruthi || "normal-G",
      });
    }
  }, [view, user]);

  function openView(nextView) {
    setView(nextView);
    setDialogOpen(true);
    setForm(nextView === "profile" && user ? {
      ...EMPTY_FORM,
      email: user.email || "",
      firstName: user.firstName || "",
      surname: user.surname || "",
      parentName: user.parentName || "",
      musicTeacherName: user.musicTeacherName || "",
      contactNumber: user.contactNumber || "",
      address: user.address || "",
      learningMode: user.learningMode || "",
      instrumentName: user.instrumentName || "",
      defaultShruthi: user.defaultShruthi || "normal-G",
    } : EMPTY_FORM);
    setMessage("");
    setError("");
  }

  function closeDialog() {
    setDialogOpen(false);
    setError("");
    setMessage("");
  }

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "learningMode" && value !== "instrument" ? { instrumentName: "" } : {}),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (view === "login") {
        await login({ email: form.email, password: form.password });
        closeDialog();
      } else if (view === "register") {
        await register(form);
        closeDialog();
      } else if (view === "profile") {
        await updateProfile(form);
        setMessage("Your details have been updated.");
      } else if (view === "forgot") {
        const result = await apiFetch("/api/auth/password-reset/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email }),
        });
        setMessage(result.message);
      } else {
        if (form.password !== form.passwordConfirm) {
          throw new Error("Passwords do not match.");
        }
        const result = await apiFetch("/api/auth/password-reset/confirm/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid: resetUid,
            token: resetToken,
            password: form.password,
          }),
        });
        window.history.replaceState({}, "", window.location.pathname);
        setView("login");
        setForm(EMPTY_FORM);
        setMessage(result.message);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setError("");
    try {
      await logout();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out.");
    }
  }

  return (
    <div className="account-menu">
      {loading ? (
        <span className="account-loading" role="status">Account…</span>
      ) : user ? (
        <>
          <a className="account-link" href="/dash-board">Dashboard</a>
          <button type="button" className="account-name" onClick={() => openView("profile")}>
            {user.firstName || user.surname
              ? `${user.firstName} ${user.surname}`.trim()
              : user.email}
          </button>
          <button type="button" className="account-link" onClick={handleLogout}>Sign out</button>
        </>
      ) : (
        <button type="button" className="account-name" onClick={() => openView("login")}>
          Sign in
        </button>
      )}
      {authError && !dialogOpen && <span className="account-status" role="alert">{authError}</span>}
      {error && !dialogOpen && <span className="account-status" role="status">{error}</span>}

      {dialogOpen && (
        <div
          className="account-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !(resetUid && resetToken)) closeDialog();
          }}
        >
          <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
            <button type="button" className="account-close" onClick={closeDialog} aria-label="Close dialog">
              ×
            </button>
            <p className="card-label">BMK SUNAADAM</p>
            <h2 id="account-dialog-title">{VIEW_TITLES[view]}</h2>
            <form className="account-form" onSubmit={handleSubmit}>
              {view === "login" && (
                <>
                  <label>Email<input type="email" name="email" value={form.email} onChange={updateField} autoComplete="email" required /></label>
                  <label>Password<input type="password" name="password" value={form.password} onChange={updateField} autoComplete="current-password" required /></label>
                  <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
                  <div className="account-form-links">
                    <button type="button" className="account-link" onClick={() => openView("forgot")}>Forgot password?</button>
                    <button type="button" className="account-link" onClick={() => openView("register")}>Create an account</button>
                  </div>
                </>
              )}

              {view === "register" && (
                <>
                  <div className="account-field-row">
                    <label>First name<input name="firstName" value={form.firstName} onChange={updateField} autoComplete="given-name" required /></label>
                    <label>Surname<input name="surname" value={form.surname} onChange={updateField} autoComplete="family-name" required /></label>
                  </div>
                  <label>Email<input type="email" name="email" value={form.email} onChange={updateField} autoComplete="email" required /></label>
                  <div className="account-field-row">
                    <label>Password<input type="password" name="password" value={form.password} onChange={updateField} autoComplete="new-password" minLength="8" required /></label>
                    <label>Confirm password<input type="password" name="passwordConfirm" value={form.passwordConfirm} onChange={updateField} autoComplete="new-password" minLength="8" required /></label>
                  </div>
                  <label>Parent's name<input name="parentName" value={form.parentName} onChange={updateField} autoComplete="name" /></label>
                  <label>Music teacher name<input name="musicTeacherName" value={form.musicTeacherName} onChange={updateField} /></label>
                  <label>Contact number<input type="tel" name="contactNumber" value={form.contactNumber} onChange={updateField} autoComplete="tel" /></label>
                  <label>Address<textarea name="address" value={form.address} onChange={updateField} autoComplete="street-address" rows="2" /></label>
                  <label>Learning type
                    <select name="learningMode" value={form.learningMode} onChange={updateField}>
                      <option value="">Select</option>
                      <option value="vocal">Vocal</option>
                      <option value="instrument">Instrument</option>
                    </select>
                  </label>
                  {form.learningMode === "instrument" && (
                    <label>Instrument name<input name="instrumentName" value={form.instrumentName} onChange={updateField} required /></label>
                  )}
                  <label>Default shruthi
                    <select name="defaultShruthi" value={form.defaultShruthi} onChange={updateField} required>
                      {SHRUTHI_OPTIONS.map((group) => (
                        <optgroup label={group.label} key={group.label}>
                          {group.notes.map((note) => (
                            <option value={note.value} key={note.value}>{note.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <p className="account-helper">New accounts are created as students.</p>
                  <button type="submit" disabled={busy}>{busy ? "Creating account…" : "Register"}</button>
                  <button type="button" className="account-link" onClick={() => openView("login")}>Already registered? Sign in</button>
                </>
              )}

              {view === "profile" && user && (
                <>
                  <p className="account-role">Account type: <strong>{user.role}</strong></p>
                  <div className="account-field-row">
                    <label>First name<input name="firstName" value={form.firstName} onChange={updateField} autoComplete="given-name" required /></label>
                    <label>Surname<input name="surname" value={form.surname} onChange={updateField} autoComplete="family-name" required /></label>
                  </div>
                  <label>Email<input type="email" name="email" value={form.email} readOnly aria-readonly="true" autoComplete="email" required /></label>
                  <label>Parent's name<input name="parentName" value={form.parentName} onChange={updateField} /></label>
                  <label>Music teacher name<input name="musicTeacherName" value={form.musicTeacherName} onChange={updateField} /></label>
                  <label>Contact number<input type="tel" name="contactNumber" value={form.contactNumber} onChange={updateField} autoComplete="tel" /></label>
                  <label>Address<textarea name="address" value={form.address} onChange={updateField} autoComplete="street-address" rows="2" /></label>
                  <label>Learning type
                    <select name="learningMode" value={form.learningMode} onChange={updateField}>
                      <option value="">Select</option>
                      <option value="vocal">Vocal</option>
                      <option value="instrument">Instrument</option>
                    </select>
                  </label>
                  {form.learningMode === "instrument" && (
                    <label>Instrument name<input name="instrumentName" value={form.instrumentName} onChange={updateField} required /></label>
                  )}
                  <label>Default shruthi
                    <select name="defaultShruthi" value={form.defaultShruthi} onChange={updateField} required>
                      {SHRUTHI_OPTIONS.map((group) => (
                        <optgroup label={group.label} key={group.label}>
                          {group.notes.map((note) => (
                            <option value={note.value} key={note.value}>{note.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
                </>
              )}

              {view === "forgot" && (
                <>
                  <p>Enter your account email. If it is registered, we will email you a reset link.</p>
                  <label>Email<input type="email" name="email" value={form.email} onChange={updateField} autoComplete="email" required /></label>
                  <button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
                  <button type="button" className="account-link" onClick={() => openView("login")}>Back to sign in</button>
                </>
              )}

              {view === "reset" && (
                <>
                  <label>New password<input type="password" name="password" value={form.password} onChange={updateField} autoComplete="new-password" minLength="8" required /></label>
                  <label>Confirm new password<input type="password" name="passwordConfirm" value={form.passwordConfirm} onChange={updateField} autoComplete="new-password" minLength="8" required /></label>
                  <button type="submit" disabled={busy}>{busy ? "Updating…" : "Reset password"}</button>
                </>
              )}

              {error && <p className="account-error" role="alert">{error}</p>}
              {message && <p className="account-message" role="status">{message}</p>}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
