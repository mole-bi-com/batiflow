# LinkedIn Selector Registry

This file maintains the current active selectors for BatiFlow's LinkedIn CDP adapter. The Skill Memory Gate dynamically scans and proposes updates to this file when page structures change.

## Authenticators & Security
- **login_check_element**: `.global-nav` (Presence indicates logged in)
- **login_prompt_element**: `form.login__form` (Presence indicates login screen)
- **security_challenge_element**: `#app__container iframe[src*="challenge"]` (Presence indicates CAPTCHA/Verification challenge)

## Post Structure
- **post_container**: `.feed-shared-update-v2, article`
- **author_name**: `.update-components-actor__name, .update-components-actor__title span[aria-hidden="true"]`
- **author_headline**: `.update-components-actor__description`
- **post_time**: `.update-components-actor__sub-text span[aria-hidden="true"]`
- **post_body**: `.feed-shared-update-v2__description-wrapper, .feed-shared-inline-show-more-text`
- **see_more_button**: `button.feed-shared-inline-show-more-text__button, button.feed-shared-text-view-more-button`

## Media Elements
- **post_images**: `.update-components-image__image, .update-components-article__image img`
- **post_image_srcset_attr**: `srcset`

## Comments Elements
- **comments_container**: `.comments-comment-list`
- **comment_item**: `.comments-comment-item`
- **comment_author**: `.comments-post-meta__name-text`
- **comment_text**: `.comments-comment-item-content-body`
