package top.showkin.lovestory;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class ApiClient {
    public interface Callback { void onSuccess(String body); void onError(String message); }

    private final SecureStore secureStore;
    private final String baseUrl;

    public ApiClient(Context context) {
        secureStore = new SecureStore(context);
        baseUrl = BuildConfig.API_BASE_URL.replaceAll("/$", "");
    }

    public void get(String path, Callback callback) { request("GET", path, null, callback); }
    public void post(String path, JSONObject body, Callback callback) { request("POST", path, body, callback); }
    public void put(String path, JSONObject body, Callback callback) { request("PUT", path, body, callback); }
    public void delete(String path, Callback callback) { request("DELETE", path, null, callback); }

    public String token(String person) { return secureStore.get("diary_token_" + person); }
    public void saveToken(String person, String value) { secureStore.put("diary_token_" + person, value); }
    public void clearToken(String person) { secureStore.remove("diary_token_" + person); }
    public String siteCookie() { return secureStore.get("site_cookie"); }

    private void request(String method, String path, JSONObject body, Callback callback) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(35000);
                connection.setRequestProperty("Accept", "application/json");
                String cookie = siteCookie();
                if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
                if (body != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    try (OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                }
                int status = connection.getResponseCode();
                String setCookie = connection.getHeaderField("Set-Cookie");
                if (setCookie != null && setCookie.contains("love_site_access=")) {
                    secureStore.put("site_cookie", setCookie.split(";", 2)[0]);
                }
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String response = read(stream);
                if (status >= 400) {
                    if (status == HttpURLConnection.HTTP_ENTITY_TOO_LARGE) {
                        throw new IllegalStateException("请求内容过大，请压缩图片或音频后重试");
                    }
                    // 反向代理可能返回 HTML 错误页，避免把整段 HTML 当成用户提示。
                    String trimmed = response.trim();
                    if (trimmed.isEmpty() || trimmed.startsWith("<")) {
                        throw new IllegalStateException("请求失败 (" + status + ")");
                    }
                    throw new IllegalStateException(trimmed);
                }
                callback.onSuccess(response);
            } catch (Exception error) {
                callback.onError(error.getMessage() == null ? "网络连接失败" : error.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
