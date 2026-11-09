package de.arfep.swapline.model

import de.arfep.swapline.net.json
import kotlinx.serialization.json.JsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdatesTest {
    private val base = "https://github.com/ARFEP-IT-Service/Swapline/releases/download"
    private fun rel(tag: String, apk: String? = "$base/$tag/Swapline-Android-x.apk", draft: Boolean = false, pre: Boolean = false) =
        """{"tag_name":"$tag","draft":$draft,"prerelease":$pre,"assets":[${apk?.let { """{"browser_download_url":"$it"}""" } ?: ""}]}"""
    private fun list(vararg r: String) = json.parseToJsonElement("[" + r.joinToString(",") + "]") as JsonArray

    @Test fun picksNewestAndroidRelease() {
        val u = Updates.pick(list(rel("v0.9.0"), rel("android-v0.1.1"), rel("android-v0.2.0"), rel("android-v0.10.0", draft = true), rel("android-v0.3.0", pre = true)), "0.1.0")!!
        assertEquals("0.2.0", u.version)
        assertEquals("$base/android-v0.2.0/Swapline-Android-x.apk", u.apkUrl)
        assertEquals("https://github.com/ARFEP-IT-Service/Swapline/releases/tag/android-v0.2.0", u.pageUrl)
    }

    @Test fun noUpdateWhenCurrentOrOnlyOlder() {
        assertNull(Updates.pick(list(rel("android-v0.1.0"), rel("v1.0.0")), "0.1.0"))
        assertNull(Updates.pick(list(rel("android-v0.0.9")), "0.1.0"))
    }

    @Test fun ignoresForeignOrMissingDownloads() {
        assertNull(Updates.pick(list(rel("android-v0.5.0", apk = "https://example.com/android-v0.5.0/x.apk")), "0.1.0"))
        assertNull(Updates.pick(list(rel("android-v0.5.0", apk = null)), "0.1.0"))
        assertNull(Updates.pick(list(rel("android-v0.5.0", apk = "$base/android-v0.4.0/x.apk")), "0.1.0")) // Datei aus anderem Release
        assertNull(Updates.pick(list(rel("android-vX.Y")), "0.1.0"))
    }

    @Test fun compareVersions() {
        assertTrue(Updates.compare("0.10.0", "0.9.9") > 0)
        assertTrue(Updates.compare("1.0.0", "1.0.0") == 0)
        assertTrue(Updates.compare("0.1.0", "0.2.0") < 0)
    }
}
