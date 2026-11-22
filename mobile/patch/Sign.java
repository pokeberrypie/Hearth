import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.security.MessageDigest;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.List;

/** Signs an APK (v2) with the Hearth debug key, the one every install so far carries. Usage: Sign in.apk out.apk keystore */
public class Sign {
  public static void main(String[] a) throws Exception {
    KeyStore ks;
    try { ks = KeyStore.getInstance("PKCS12"); try (FileInputStream f = new FileInputStream(a[2])) { ks.load(f, "android".toCharArray()); } }
    catch (Exception e) { ks = KeyStore.getInstance("JKS"); try (FileInputStream f = new FileInputStream(a[2])) { ks.load(f, "android".toCharArray()); } }
    PrivateKey key = (PrivateKey) ks.getKey("androiddebugkey", "android".toCharArray());
    X509Certificate cert = (X509Certificate) ks.getCertificate("androiddebugkey");
    ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder("androiddebugkey", key, List.of(cert)).build();
    new ApkSigner.Builder(List.of(cfg)).setInputApk(new File(a[0])).setOutputApk(new File(a[1]))
      .setMinSdkVersion(26).setV1SigningEnabled(false).setV2SigningEnabled(true).setV3SigningEnabled(false)
      .build().sign();
    // Proved, not assumed: verified as Android will, and the certificate it carries named.
    ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[1])).build().verify();
    if (!r.isVerified()) { System.err.println("NOT VERIFIED: " + r.getErrors()); System.exit(1); }
    byte[] d = MessageDigest.getInstance("SHA-256").digest(r.getSignerCertificates().get(0).getEncoded());
    StringBuilder fp = new StringBuilder();
    for (int i = 0; i < d.length; i++) fp.append(i > 0 ? ":" : "").append(String.format("%02X", d[i]));
    System.out.println("signed and verified " + a[1] + " (v2=" + r.isVerifiedUsingV2Scheme() + ") cert " + fp);
  }
}
