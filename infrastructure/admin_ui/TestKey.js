// Static ECDSA P-256 key pair used by qr.html for signing auth sessions and
// syncing a public key to the eVault. Replaces the "New Key" button: the page
// always loads this key instead of generating a random one at runtime.
window.TEST_KEY = {
    privateJwk: {
        key_ops: ["sign"],
        ext: true,
        kty: "EC",
        x: "f-y8VPfthFqzbom_LepDu16J2GaVF6PL9ipoBAFppJk",
        y: "GQ1ySegyNWQ8YoprD_Mb3Gj2FBdhUcVFuahXIr5B100",
        crv: "P-256",
        d: "1L-ILXZCbTKdVjupqbbJ0z0sLcZZso_8GA1sHjU2PYg",
    },
    publicKeyB64:
        "BH_svFT37YRas26Jvy3qQ7teidhmlRejy_YqaAQBaaSZGQ1ySegyNWQ8YoprD_Mb3Gj2FBdhUcVFuahXIr5B100",
};
