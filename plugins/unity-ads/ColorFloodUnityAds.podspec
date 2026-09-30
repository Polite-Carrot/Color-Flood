require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'ColorFloodUnityAds'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary' }
  s.homepage = 'https://github.com/Polite-Carrot/color-flood'
  s.author = package['author']
  s.source = { :git => 'https://github.com/Polite-Carrot/color-flood.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  # Pinned exactly, like the Android side. An ad SDK that moves under you
  # between two TestFlight builds is a bug report you cannot reproduce.
  s.dependency 'UnityAds', '4.20.1'
  s.swift_version = '5.1'
  # The Podfile says use_frameworks!, and a pod that depends on a statically
  # linked vendored framework has to be static itself or CocoaPods refuses
  # the whole install. Harmless if UnityAds turns out to be dynamic.
  s.static_framework = true
end
