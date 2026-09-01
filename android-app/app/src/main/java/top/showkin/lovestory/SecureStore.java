package top.showkin.lovestory;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Small encrypted key/value store for session cookies and diary tokens. */
public final class SecureStore {
    private static final String KEY_ALIAS = "LoveStorySecureStore";
    private static final String PREFS = "lovestory_secure";
    private static final String IV_SUFFIX = ".iv";
    private final SharedPreferences preferences;

    public SecureStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        ensureKey();
    }

    public void put(String name, String value) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getKey());
            String encoded = Base64.getEncoder().encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)));
            String iv = Base64.getEncoder().encodeToString(cipher.getIV());
            preferences.edit().putString(name, encoded).putString(name + IV_SUFFIX, iv).apply();
        } catch (Exception ignored) { }
    }

    public String get(String name) {
        try {
            String value = preferences.getString(name, null);
            String iv = preferences.getString(name + IV_SUFFIX, null);
            if (value == null || iv == null) return null;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, Base64.getDecoder().decode(iv)));
            return new String(cipher.doFinal(Base64.getDecoder().decode(value)), StandardCharsets.UTF_8);
        } catch (Exception ignored) { return null; }
    }

    public void remove(String name) { preferences.edit().remove(name).remove(name + IV_SUFFIX).apply(); }

    private void ensureKey() {
        try {
            java.security.KeyStore keyStore = java.security.KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (!keyStore.containsAlias(KEY_ALIAS)) {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build());
                generator.generateKey();
            }
        } catch (Exception ignored) { }
    }

    private SecretKey getKey() throws Exception {
        java.security.KeyStore keyStore = java.security.KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        return ((SecretKey) keyStore.getKey(KEY_ALIAS, null));
    }
}
