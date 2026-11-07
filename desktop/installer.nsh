!macro customInstall
  ${ifNot} ${isUpdated}
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend
